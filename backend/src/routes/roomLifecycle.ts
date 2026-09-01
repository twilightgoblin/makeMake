// -----------------------------------------------------------------------------
// Makemake — Room lifecycle routes
//
// DELETE /rooms/:id
//   HOST closes the room explicitly.
//
// PATCH  /rooms/:id/participants/:participantId/leave
//   A participant leaves. If the HOST leaves, responsibility transfers to the
//   earliest-joined remaining active participant. If the last participant
//   leaves, the room is set to INACTIVE.
// -----------------------------------------------------------------------------

import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireParticipant } from "../middleware/requireParticipant.js";
import { requireHost } from "../middleware/requireHost.js";
import { AppError, notFound } from "../lib/errors.js";
import type { Participant } from "@prisma/client";

export const roomLifecycleRouter = Router();

// ---------------------------------------------------------------------------
// DELETE /rooms/:id
//
// Headers: X-Participant-Id (required, must be HOST)
// Returns: 200 { room: { id, status } }
//
// Errors:
//   401 MISSING_PARTICIPANT_ID
//   403 NOT_A_PARTICIPANT / HOST_ONLY
//   404 NOT_FOUND
//   409 ROOM_ALREADY_CLOSED
// ---------------------------------------------------------------------------

roomLifecycleRouter.delete(
  "/:id",
  requireParticipant,
  requireHost,
  async (req, res) => {
    const roomId = String(req.params["id"]);

    const room = await prisma.room.findUnique({ where: { id: roomId } });

    if (!room) {
      throw notFound("Room");
    }

    if (room.status === "CLOSED") {
      throw new AppError(409, "ROOM_ALREADY_CLOSED", "This room is already closed.");
    }

    const updated = await prisma.room.update({
      where: { id: roomId },
      data: { status: "CLOSED" },
    });

    res.json({ room: { id: updated.id, status: updated.status } });
  },
);

// ---------------------------------------------------------------------------
// PATCH /rooms/:id/participants/:participantId/leave
//
// The participant identified by :participantId sends this request.
// The X-Participant-Id header must match :participantId (you can only leave
// yourself — no one can remove another participant via this endpoint).
//
// Returns: 200 { participant: { id, leftAt }, room: { id, status }, newHost? }
//   newHost is included when HOST transfer occurred.
//
// Errors:
//   401 MISSING_PARTICIPANT_ID
//   403 NOT_A_PARTICIPANT (header ≠ param, or participant not in this room)
//   404 NOT_FOUND
//   409 ALREADY_LEFT
// ---------------------------------------------------------------------------

roomLifecycleRouter.patch(
  "/:id/participants/:participantId/leave",
  requireParticipant,
  async (req, res) => {
    const roomId = String(req.params["id"]);
    const participantId = String(req.params["participantId"]);
    const caller = res.locals["participant"] as Participant;

    // You can only leave as yourself.
    if (caller.id !== participantId) {
      throw new AppError(403, "FORBIDDEN", "You can only remove yourself from a room.");
    }

    if (caller.leftAt !== null) {
      throw new AppError(409, "ALREADY_LEFT", "You have already left this room.");
    }

    const now = new Date();

    // Mark the participant as having left.
    const updated = await prisma.participant.update({
      where: { id: participantId },
      data: { leftAt: now },
    });

    // Find remaining active participants in join-order.
    const remaining = await prisma.participant.findMany({
      where: { roomId, leftAt: null },
      orderBy: { joinedAt: "asc" },
    });

    let newHost: Participant | null = null;
    let roomStatus = "ACTIVE" as "ACTIVE" | "INACTIVE";

    if (remaining.length === 0) {
      // Last person left → room goes INACTIVE.
      roomStatus = "INACTIVE";
      await prisma.room.update({
        where: { id: roomId },
        data: { status: "INACTIVE" },
      });
    } else if (caller.role === "HOST") {
      // HOST left but others remain → transfer to earliest-joined.
      newHost = remaining[0]!;
      await prisma.participant.update({
        where: { id: newHost.id },
        data: { role: "HOST" },
      });
    }

    res.json({
      participant: { id: updated.id, leftAt: updated.leftAt },
      room: { id: roomId, status: roomStatus },
      ...(newHost && {
        newHost: {
          id: newHost.id,
          displayName: newHost.displayName,
          role: "HOST",
        },
      }),
    });
  },
);
