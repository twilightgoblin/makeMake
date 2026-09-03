// -----------------------------------------------------------------------------
// Makemake — WS playback handler
//
// Handles: PLAY, PAUSE, SEEK, NEXT, PREVIOUS
//
// All playback events are HOST-only.
// Each handler:
//   1. Verifies caller is HOST
//   2. Validates payload
//   3. Updates Room row in DB (isPlaying, positionSecs, stateUpdatedAt,
//      currentSongId for NEXT/PREVIOUS)
//   4. Broadcasts the event to the entire room (including the caller)
// -----------------------------------------------------------------------------

import type WebSocket from "ws";
import { prisma } from "../../lib/prisma.js";
import {
  makeServerEvent,
  makeErrorEvent,
  type ClientEnvelope,
  type PlayPayload,
  type PausePayload,
  type SeekPayload,
  type SetSongPayload,
  type PlayBroadcastPayload,
  type PauseBroadcastPayload,
  type SeekBroadcastPayload,
  type SongChangeBroadcastPayload,
} from "../../lib/wsTypes.js";
import { getConnection, sendTo } from "../connectionManager.js";
import { publishRoomEvent } from "../../lib/roomEvents.js";

export async function handlePlayback(
  socket: WebSocket,
  participantId: string,
  roomId: string,
  envelope: ClientEnvelope,
): Promise<void> {
  // -------------------------------------------------------------------------
  // HOST-only guard
  // -------------------------------------------------------------------------
  const connection = getConnection(participantId);
  if (!connection || connection.role !== "HOST") {
    sendTo(
      socket,
      makeErrorEvent("HOST_ONLY", "Only the room host can control playback.", envelope.requestId),
    );
    return;
  }

  // -------------------------------------------------------------------------
  // Route to the specific event handler
  // -------------------------------------------------------------------------
  switch (envelope.type) {
    case "PLAY":
      await handlePlay(roomId, envelope);
      break;
    case "PAUSE":
      await handlePause(roomId, envelope);
      break;
    case "SEEK":
      await handleSeek(socket, roomId, envelope);
      break;
    case "NEXT":
      await handleNext(roomId, envelope);
      break;
    case "PREVIOUS":
      await handlePrevious(roomId, envelope);
      break;
    case "SET_SONG":
      await handleSetSong(socket, roomId, envelope);
      break;
  }
}

// ---------------------------------------------------------------------------
// PLAY
// ---------------------------------------------------------------------------
async function handlePlay(roomId: string, envelope: ClientEnvelope): Promise<void> {
  const payload = envelope.payload as PlayPayload;
  const positionSecs = typeof payload?.positionSecs === "number" ? payload.positionSecs : 0;

  const now = new Date();
  const updated = await prisma.room.update({
    where: { id: roomId },
    data: { isPlaying: true, positionSecs, stateUpdatedAt: now },
    select: { currentSongId: true },
  });

  const broadcast: PlayBroadcastPayload = {
    songId: updated.currentSongId,
    positionSecs,
    stateUpdatedAt: now.toISOString(),
  };

  await publishRoomEvent(roomId, makeServerEvent("PLAY", broadcast));
}

// ---------------------------------------------------------------------------
// PAUSE
// ---------------------------------------------------------------------------
async function handlePause(roomId: string, envelope: ClientEnvelope): Promise<void> {
  const payload = envelope.payload as PausePayload;
  const positionSecs = typeof payload?.positionSecs === "number" ? payload.positionSecs : 0;

  const now = new Date();
  const updated = await prisma.room.update({
    where: { id: roomId },
    data: { isPlaying: false, positionSecs, stateUpdatedAt: now },
    select: { currentSongId: true },
  });

  const broadcast: PauseBroadcastPayload = {
    songId: updated.currentSongId,
    positionSecs,
    stateUpdatedAt: now.toISOString(),
  };

  await publishRoomEvent(roomId, makeServerEvent("PAUSE", broadcast));
}

// ---------------------------------------------------------------------------
// SEEK
// ---------------------------------------------------------------------------
async function handleSeek(
  socket: WebSocket,
  roomId: string,
  envelope: ClientEnvelope,
): Promise<void> {
  const payload = envelope.payload as SeekPayload;

  if (typeof payload?.positionSecs !== "number" || payload.positionSecs < 0) {
    sendTo(
      socket,
      makeErrorEvent("INVALID_PAYLOAD", "positionSecs must be a non-negative number.", envelope.requestId),
    );
    return;
  }

  // Validate against song duration
  const room = await prisma.room.findUnique({
    where: { id: roomId },
    select: { currentSongId: true, currentSong: { select: { duration: true } } },
  });

  if (room?.currentSong && payload.positionSecs > room.currentSong.duration) {
    sendTo(
      socket,
      makeErrorEvent(
        "SEEK_OUT_OF_RANGE",
        `positionSecs ${payload.positionSecs} exceeds song duration ${room.currentSong.duration}.`,
        envelope.requestId,
      ),
    );
    return;
  }

  const now = new Date();
  await prisma.room.update({
    where: { id: roomId },
    data: { positionSecs: payload.positionSecs, stateUpdatedAt: now },
  });

  const broadcast: SeekBroadcastPayload = {
    songId: room?.currentSongId ?? null,
    positionSecs: payload.positionSecs,
    stateUpdatedAt: now.toISOString(),
  };

  await publishRoomEvent(roomId, makeServerEvent("SEEK", broadcast));
}

// ---------------------------------------------------------------------------
// NEXT
// ---------------------------------------------------------------------------
async function handleNext(roomId: string, envelope: ClientEnvelope): Promise<void> {
  await changeSong(roomId, envelope, "next");
}

// ---------------------------------------------------------------------------
// PREVIOUS
// ---------------------------------------------------------------------------
async function handlePrevious(roomId: string, envelope: ClientEnvelope): Promise<void> {
  await changeSong(roomId, envelope, "previous");
}

// ---------------------------------------------------------------------------
// Shared song-change logic for NEXT / PREVIOUS
// ---------------------------------------------------------------------------
async function changeSong(
  roomId: string,
  envelope: ClientEnvelope,
  direction: "next" | "previous",
): Promise<void> {
  const room = await prisma.room.findUnique({
    where: { id: roomId },
    select: { currentSongId: true, isPlaying: true, playlist: { orderBy: { position: "asc" }, select: { id: true, position: true, songId: true } } },
  });

  if (!room) return;

  const playlist = room.playlist;
  if (playlist.length === 0) return;

  // Find the current entry index
  const currentIdx = playlist.findIndex((e) => e.songId === room.currentSongId);

  let targetIdx: number;
  if (direction === "next") {
    targetIdx = currentIdx >= 0 && currentIdx < playlist.length - 1 ? currentIdx + 1 : 0;
  } else {
    targetIdx = currentIdx > 0 ? currentIdx - 1 : playlist.length - 1;
  }

  const targetEntry = playlist[targetIdx];
  if (!targetEntry) return;

  const now = new Date();
  await prisma.room.update({
    where: { id: roomId },
    data: {
      currentSongId: targetEntry.songId,
      positionSecs: 0,
      // Preserve the playing/paused state the room was already in
      isPlaying: room.isPlaying,
      stateUpdatedAt: now,
    },
  });

  const broadcast: SongChangeBroadcastPayload = {
    songId: targetEntry.songId,
    positionSecs: 0,
    isPlaying: room.isPlaying,
    stateUpdatedAt: now.toISOString(),
  };

  const eventType = direction === "next" ? "NEXT" : "PREVIOUS";
  await publishRoomEvent(roomId, makeServerEvent(eventType, broadcast));
}

// ---------------------------------------------------------------------------
// SET_SONG — HOST jumps directly to a specific playlist entry
// Pauses playback, sets currentSongId to the entry's song, resets position.
// Broadcasts as a NEXT-style SongChangeBroadcastPayload so clients reload audio.
// ---------------------------------------------------------------------------
async function handleSetSong(
  socket: WebSocket,
  roomId: string,
  envelope: ClientEnvelope,
): Promise<void> {
  const payload = envelope.payload as SetSongPayload;

  if (!payload?.entryId || typeof payload.entryId !== "string") {
    sendTo(socket, makeErrorEvent("INVALID_PAYLOAD", '"entryId" is required.', envelope.requestId));
    return;
  }

  const entry = await prisma.playlistEntry.findFirst({
    where: { id: payload.entryId, roomId },
    select: { songId: true },
  });

  if (!entry) {
    sendTo(socket, makeErrorEvent("PLAYLIST_ENTRY_NOT_FOUND", "Playlist entry not found.", envelope.requestId));
    return;
  }

  const now = new Date();
  const isPlaying = payload.play === true;
  const updated = await prisma.room.update({
    where: { id: roomId },
    data: {
      currentSongId: entry.songId,
      positionSecs: 0,
      isPlaying,
      stateUpdatedAt: now,
    },
    select: { isPlaying: true },
  });

  const broadcast: SongChangeBroadcastPayload = {
    songId: entry.songId,
    positionSecs: 0,
    isPlaying,
    stateUpdatedAt: now.toISOString(),
  };

  // Reuse NEXT event type on the wire — same payload shape, clients handle it identically.
  await publishRoomEvent(roomId, makeServerEvent("NEXT", broadcast));
  void updated;
}
