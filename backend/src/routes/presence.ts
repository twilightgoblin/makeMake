// -----------------------------------------------------------------------------
// Makemake — Presence route
//
// GET /rooms/:id/presence
//
// Returns the live Redis presence for a room — queryable from any server
// instance because both read the same Redis keys.
//
// This is separate from GET /rooms/:id (which returns DB membership).
// The distinction:
//   /rooms/:id          → who *belongs* to the room (PostgreSQL)
//   /rooms/:id/presence → who is *currently connected* (Redis)
//
// No authentication required — the presence data is not sensitive and
// is needed by unauthenticated clients (e.g. the join flow) to show
// online indicators.
// -----------------------------------------------------------------------------

import { Router } from "express";
import { getRoomPresence } from "../lib/presence.js";
import { prisma } from "../lib/prisma.js";
import { notFound } from "../lib/errors.js";

export const presenceRouter = Router();

// ---------------------------------------------------------------------------
// GET /rooms/:id/presence
//
// Returns: 200 {
//   roomId,
//   onlineCount,
//   participants: [{ participantId, serverId, connectedAt }]
// }
//
// Errors:
//   404 NOT_FOUND — no room with that id
// ---------------------------------------------------------------------------

presenceRouter.get("/:id/presence", async (req, res) => {
  const roomId = String(req.params["id"]);

  // Verify the room exists (presence for a non-existent room should 404,
  // not return an empty list that could mislead callers).
  const room = await prisma.room.findUnique({
    where: { id: roomId },
    select: { id: true },
  });

  if (!room) {
    throw notFound("Room");
  }

  const records = await getRoomPresence(roomId);

  res.json({
    roomId,
    onlineCount: records.length,
    participants: records.map((r) => ({
      participantId: r.participantId,
      serverId: r.serverId,
      connectedAt: r.connectedAt,
    })),
  });
});
