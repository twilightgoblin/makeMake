// -----------------------------------------------------------------------------
// Makemake — Room detail route
//
// GET /rooms/:id — returns full room state for an active participant.
// This is the hydration endpoint: a client connects here before opening the
// WebSocket so it has current playback state, participants, and playlist.
// -----------------------------------------------------------------------------

import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireParticipant } from "../middleware/requireParticipant.js";
import { isConnected } from "../ws/connectionManager.js";
import type { Participant } from "@prisma/client";

export const roomDetailRouter = Router();

// ---------------------------------------------------------------------------
// GET /rooms/:id
//
// Headers: X-Participant-Id (required)
// Returns: 200 {
//   room: { id, code, status, playback, participants, pendingJoinRequests? }
// }
//
// playback: { currentSong, isPlaying, positionSecs, stateUpdatedAt }
// participants: active only (leftAt === null)
// pendingJoinRequests: only included if caller is HOST
// ---------------------------------------------------------------------------

roomDetailRouter.get("/:id", requireParticipant, async (req, res) => {
  const roomId = String(req.params["id"]);
  const caller = res.locals["participant"] as Participant;

  // Fetch core room data + active participants in one query.
  const room = await prisma.room.findUnique({
    where: { id: roomId },
    include: {
      currentSong: {
        select: {
          id: true,
          title: true,
          artist: true,
          album: true,
          duration: true,
          coverUrl: true,
          audioUrl: true,
        },
      },
      participants: {
        where: { leftAt: null },
        orderBy: { joinedAt: "asc" },
        select: {
          id: true,
          displayName: true,
          role: true,
          joinedAt: true,
        },
      },
    },
  });

  // requireParticipant already confirmed the room exists, but be defensive.
  if (!room) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Room not found." } });
    return;
  }

  // Fetch pending join requests separately if the caller is HOST.
  // (Avoids a complex conditional include that TypeScript can't narrow.)
  const pendingJoinRequests =
    caller.role === "HOST"
      ? await prisma.joinRequest.findMany({
          where: { roomId, status: "PENDING" },
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            displayName: true,
            status: true,
            createdAt: true,
          },
        })
      : undefined;

  res.json({
    room: {
      id: room.id,
      code: room.code,
      status: room.status,
      playback: {
        currentSong: room.currentSong ?? null,
        isPlaying: room.isPlaying,
        positionSecs: room.positionSecs,
        stateUpdatedAt: room.stateUpdatedAt ?? null,
      },
      participants: room.participants.map((p) => ({
          ...p,
          isOnline: isConnected(p.id),
        })),
      ...(pendingJoinRequests !== undefined && { pendingJoinRequests }),
    },
  });
});
