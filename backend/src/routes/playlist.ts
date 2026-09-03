// -----------------------------------------------------------------------------
// Makemake — Playlist routes
//
// GET    /rooms/:id/playlist              — list all entries in order
// POST   /rooms/:id/playlist              — add a song (appends to end)
// DELETE /rooms/:id/playlist/:entryId     — remove an entry (compacts gaps)
// PATCH  /rooms/:id/playlist/:entryId/position — move an entry to a new slot
//
// All routes require an active participant (X-Participant-Id header).
// Any participant (HOST or MEMBER) can add, remove, and reorder.
// -----------------------------------------------------------------------------

import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireParticipant } from "../middleware/requireParticipant.js";
import { notFound, invalidBody, AppError } from "../lib/errors.js";
import type { Participant } from "@prisma/client";
import { publishRoomEvent } from "../lib/roomEvents.js";
import {
  makeServerEvent,
  type PlaylistAddBroadcastPayload,
  type PlaylistRemoveBroadcastPayload,
  type PlaylistReorderBroadcastPayload,
} from "../lib/wsTypes.js";

export const playlistRouter = Router();

// ---------------------------------------------------------------------------
// GET /rooms/:id/playlist
//
// Returns: 200 { playlist: PlaylistEntry[] }
// Each entry includes the Song details inline.
// ---------------------------------------------------------------------------

playlistRouter.get("/:id/playlist", requireParticipant, async (req, res) => {
  const roomId = String(req.params["id"]);

  const entries = await prisma.playlistEntry.findMany({
    where: { roomId },
    orderBy: { position: "asc" },
    select: {
      id: true,
      position: true,
      addedById: true,
      addedAt: true,
      song: {
        select: {
          id: true,
          provider: true,
          externalId: true,
          title: true,
          artist: true,
          album: true,
          duration: true,
          coverUrl: true,
        },
      },
    },
  });

  res.json({ playlist: entries });
});

// ---------------------------------------------------------------------------
// POST /rooms/:id/playlist
//
// Body: { songId: string }
// Appends the song at the next available position (max + 1, or 0 if empty).
//
// Returns: 201 { entry: PlaylistEntry }
//
// Errors:
//   400 INVALID_BODY  — songId missing
//   404 NOT_FOUND     — song not in library
// ---------------------------------------------------------------------------

playlistRouter.post("/:id/playlist", requireParticipant, async (req, res) => {
  const roomId = String(req.params["id"]);
  const caller = res.locals["participant"] as Participant;

  const { songId } = req.body ?? {};
  if (!songId || typeof songId !== "string") {
    throw invalidBody('"songId" is required.');
  }

  const song = await prisma.song.findUnique({ where: { id: songId } });
  if (!song) {
    throw notFound("Song");
  }

  // Find the current max position in this room's playlist.
  const last = await prisma.playlistEntry.findFirst({
    where: { roomId },
    orderBy: { position: "desc" },
    select: { position: true },
  });

  const nextPosition = last !== null ? last.position + 1 : 0;

  const entry = await prisma.playlistEntry.create({
    data: {
      roomId,
      songId,
      position: nextPosition,
      addedById: caller.id,
    },
    select: {
      id: true,
      position: true,
      addedById: true,
      addedAt: true,
      song: {
        select: {
          id: true,
          provider: true,
          externalId: true,
          title: true,
          artist: true,
          album: true,
          duration: true,
          coverUrl: true,
        },
      },
    },
  });

  const broadcast: PlaylistAddBroadcastPayload = {
    entry: {
      id: entry.id,
      position: entry.position,
      addedById: entry.addedById,
      addedAt: entry.addedAt.toISOString(),
      song: {
        id: entry.song.id,
        provider: entry.song.provider,
        externalId: entry.song.externalId,
        title: entry.song.title,
        artist: entry.song.artist,
        album: entry.song.album,
        duration: entry.song.duration,
        coverUrl: entry.song.coverUrl,
      },
    },
  };

  await publishRoomEvent(roomId, makeServerEvent("PLAYLIST_ADD", broadcast));

  res.status(201).json({ entry });
});

// ---------------------------------------------------------------------------
// DELETE /rooms/:id/playlist/:entryId
//
// Removes the entry and compacts the positions of all entries that came after
// it so there are no gaps. This keeps position values contiguous (0, 1, 2…).
//
// Returns: 200 { deleted: { id } }
//
// Errors:
//   404 NOT_FOUND — entry not found in this room's playlist
// ---------------------------------------------------------------------------

playlistRouter.delete(
  "/:id/playlist/:entryId",
  requireParticipant,
  async (req, res) => {
    const roomId = String(req.params["id"]);
    const entryId = String(req.params["entryId"]);

    const entry = await prisma.playlistEntry.findFirst({
      where: { id: entryId, roomId },
    });

    if (!entry) {
      throw notFound("Playlist entry");
    }

    await prisma.$transaction(async (tx) => {
      // Delete the target entry.
      await tx.playlistEntry.delete({ where: { id: entryId } });

      // Shift all later entries down by 1 to close the gap.
      // Prisma doesn't support bulk relative updates in one call, so we use
      // a raw query which is safe here — roomId and position are typed integers/strings.
      await tx.$executeRaw`
        UPDATE playlist_entries
        SET position = position - 1
        WHERE "roomId" = ${roomId}
          AND position > ${entry.position}
      `;
    });

    const updatedPlaylist = await prisma.playlistEntry.findMany({
      where: { roomId },
      orderBy: { position: "asc" },
      select: { id: true, position: true },
    });

    const broadcast: PlaylistRemoveBroadcastPayload = {
      entryId,
      playlist: updatedPlaylist,
    };

    await publishRoomEvent(roomId, makeServerEvent("PLAYLIST_REMOVE", broadcast));

    res.json({ deleted: { id: entryId } });
  },
);

// ---------------------------------------------------------------------------
// PATCH /rooms/:id/playlist/:entryId/position
//
// Moves an entry to a new position. All other entries shift to accommodate.
// Uses a "remove then insert" approach within a transaction:
//   1. Remove the entry from its current slot (compact remaining).
//   2. Open a slot at the target position (shift entries ≥ target up by 1).
//   3. Set the entry's position to the target.
//
// Body:    { position: number }  — 0-indexed target position
// Returns: 200 { entry: { id, position } }
//
// Errors:
//   400 INVALID_BODY   — position missing or not a non-negative integer
//   404 NOT_FOUND      — entry not found in this room's playlist
//   422 OUT_OF_RANGE   — target position > current playlist length - 1
// ---------------------------------------------------------------------------

playlistRouter.patch(
  "/:id/playlist/:entryId/position",
  requireParticipant,
  async (req, res) => {
    const roomId = String(req.params["id"]);
    const entryId = String(req.params["entryId"]);

    // Validate target position from body.
    const rawPosition = req.body?.position;
    if (rawPosition === undefined || rawPosition === null) {
      throw invalidBody('"position" is required.');
    }
    const targetPosition = Number(rawPosition);
    if (!Number.isInteger(targetPosition) || targetPosition < 0) {
      throw invalidBody('"position" must be a non-negative integer.');
    }

    const entry = await prisma.playlistEntry.findFirst({
      where: { id: entryId, roomId },
    });

    if (!entry) {
      throw notFound("Playlist entry");
    }

    if (entry.position === targetPosition) {
      // No-op — already in the right place.
      res.json({ entry: { id: entry.id, position: entry.position } });
      return;
    }

    const playlistSize = await prisma.playlistEntry.count({ where: { roomId } });

    // Target must be within the current playlist (0 … size-1).
    if (targetPosition > playlistSize - 1) {
      throw new AppError(
        422,
        "OUT_OF_RANGE",
        `position must be between 0 and ${playlistSize - 1}.`,
      );
    }

    await prisma.$transaction(async (tx) => {
      const from = entry.position;
      const to = targetPosition;

      // Park the moving entry at -1 to vacate its current slot.
      // This prevents the unique constraint on (roomId, position) from
      // firing during the gap-closing shift below.
      await tx.$executeRaw`
        UPDATE playlist_entries
        SET position = -1
        WHERE id = ${entryId}
      `;

      if (from < to) {
        // Moving down: close the gap by shifting entries in (from+1 … to) up by -1.
        await tx.$executeRaw`
          UPDATE playlist_entries
          SET position = position - 1
          WHERE "roomId" = ${roomId}
            AND position > ${from}
            AND position <= ${to}
        `;
      } else {
        // Moving up: open a slot by shifting entries in (to … from-1) down by +1.
        await tx.$executeRaw`
          UPDATE playlist_entries
          SET position = position + 1
          WHERE "roomId" = ${roomId}
            AND position >= ${to}
            AND position < ${from}
        `;
      }

      // Land the entry at its final position.
      await tx.$executeRaw`
        UPDATE playlist_entries
        SET position = ${to}
        WHERE id = ${entryId}
      `;
    });

    const updatedPlaylist = await prisma.playlistEntry.findMany({
      where: { roomId },
      orderBy: { position: "asc" },
      select: { id: true, position: true },
    });

    const broadcast: PlaylistReorderBroadcastPayload = {
      entryId,
      playlist: updatedPlaylist,
    };

    await publishRoomEvent(roomId, makeServerEvent("PLAYLIST_REORDER", broadcast));

    res.json({ entry: { id: entry.id, position: targetPosition } });
  },
);
