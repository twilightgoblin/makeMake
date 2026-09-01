// -----------------------------------------------------------------------------
// Makemake — Join-request routes
//
// POST  /rooms/:code/join-requests          — guest submits a join request
// PATCH /rooms/:id/join-requests/:requestId — host accepts or rejects
// -----------------------------------------------------------------------------

import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { validateDisplayName } from "../lib/validate.js";
import { notFound, conflict, unprocessable, AppError } from "../lib/errors.js";
import { requireParticipant } from "../middleware/requireParticipant.js";
import { requireHost } from "../middleware/requireHost.js";

export const joinRequestsRouter = Router();

// ---------------------------------------------------------------------------
// POST /rooms/:code/join-requests
//
// Anyone with a room code can submit a join request.
// No participant identity required — the requester has none yet.
//
// Body:    { displayName: string }
// Returns: 201 { joinRequest: { id, displayName, status, roomId, createdAt } }
//
// Errors:
//   400 INVALID_DISPLAY_NAME   — bad display name
//   404 NOT_FOUND              — no room with that code
//   409 ROOM_NOT_ACCEPTING     — room is CLOSED or INACTIVE
//   409 PENDING_REQUEST_EXISTS — they already have a pending request
// ---------------------------------------------------------------------------

joinRequestsRouter.post("/:code/join-requests", async (req, res) => {
  const code = String(req.params["code"]);
  const displayName = validateDisplayName(req.body?.displayName);

  const room = await prisma.room.findUnique({ where: { code } });

  if (!room) {
    throw notFound("Room");
  }

  if (room.status === "CLOSED") {
    throw conflict("ROOM_NOT_ACCEPTING", "This room is closed and no longer accepts join requests.");
  }

  if (room.status === "INACTIVE") {
    throw conflict("ROOM_NOT_ACCEPTING", "This room is currently inactive.");
  }

  // Prevent duplicate pending requests (e.g. someone spam-clicking join).
  const existing = await prisma.joinRequest.findFirst({
    where: {
      roomId: room.id,
      displayName,
      status: "PENDING",
    },
  });

  if (existing) {
    throw conflict(
      "PENDING_REQUEST_EXISTS",
      "A pending join request with this display name already exists.",
    );
  }

  const joinRequest = await prisma.joinRequest.create({
    data: {
      displayName,
      roomId: room.id,
    },
  });

  res.status(201).json({
    joinRequest: {
      id: joinRequest.id,
      displayName: joinRequest.displayName,
      status: joinRequest.status,
      roomId: joinRequest.roomId,
      createdAt: joinRequest.createdAt,
    },
  });
});

// ---------------------------------------------------------------------------
// PATCH /rooms/:id/join-requests/:requestId
//
// HOST only. Accepts or rejects a pending join request.
// On acceptance: creates a Participant row for the requester.
//
// Body:    { action: "ACCEPT" | "REJECT" }
// Returns: 200 { joinRequest, participant? }
//   participant is included only when action === "ACCEPT"
//
// Errors:
//   400 INVALID_BODY      — action not provided or not ACCEPT/REJECT
//   401 MISSING_PARTICIPANT_ID
//   403 NOT_A_PARTICIPANT / HOST_ONLY
//   404 NOT_FOUND         — join request not found in this room
//   409 REQUEST_NOT_PENDING — already resolved
// ---------------------------------------------------------------------------

joinRequestsRouter.patch(
  "/:id/join-requests/:requestId",
  requireParticipant,
  requireHost,
  async (req, res) => {
    const roomId = String(req.params["id"]);
    const requestId = String(req.params["requestId"]);
    const { action } = req.body ?? {};

    if (action !== "ACCEPT" && action !== "REJECT") {
      throw new AppError(
        400,
        "INVALID_BODY",
        'action must be either "ACCEPT" or "REJECT".',
      );
    }

    const joinRequest = await prisma.joinRequest.findFirst({
      where: { id: requestId, roomId },
    });

    if (!joinRequest) {
      throw notFound("Join request");
    }

    if (joinRequest.status !== "PENDING") {
      throw conflict(
        "REQUEST_NOT_PENDING",
        "This join request has already been resolved.",
      );
    }

    if (action === "REJECT") {
      const updated = await prisma.joinRequest.update({
        where: { id: requestId },
        data: { status: "REJECTED", resolvedAt: new Date() },
      });

      return res.json({
        joinRequest: {
          id: updated.id,
          displayName: updated.displayName,
          status: updated.status,
          roomId: updated.roomId,
          resolvedAt: updated.resolvedAt,
        },
      });
    }

    // ACCEPT — resolve the request and create a participant atomically.
    const { updatedRequest, participant } = await prisma.$transaction(async (tx) => {
      const updatedRequest = await tx.joinRequest.update({
        where: { id: requestId },
        data: { status: "ACCEPTED", resolvedAt: new Date() },
      });

      const participant = await tx.participant.create({
        data: {
          displayName: joinRequest.displayName,
          role: "MEMBER",
          roomId,
        },
      });

      // Ensure the room is marked ACTIVE (it may have gone INACTIVE if everyone left).
      await tx.room.update({
        where: { id: roomId },
        data: { status: "ACTIVE" },
      });

      return { updatedRequest, participant };
    });

    res.json({
      joinRequest: {
        id: updatedRequest.id,
        displayName: updatedRequest.displayName,
        status: updatedRequest.status,
        roomId: updatedRequest.roomId,
        resolvedAt: updatedRequest.resolvedAt,
      },
      participant: {
        id: participant.id,
        displayName: participant.displayName,
        role: participant.role,
        roomId: participant.roomId,
        joinedAt: participant.joinedAt,
      },
    });
  },
);
