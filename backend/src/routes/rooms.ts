// -----------------------------------------------------------------------------
// Makemake — /rooms routes
// POST /rooms  — create a room + host participant in one transaction
// -----------------------------------------------------------------------------

import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { validateDisplayName } from "../lib/validate.js";
import { generateRoomCode } from "../lib/roomCode.js";
import { conflict } from "../lib/errors.js";

export const roomsRouter = Router();

// ---------------------------------------------------------------------------
// POST /rooms
// Body: { displayName: string }
// Response 201: { room: { id, code, status }, participant: { id, displayName, role } }
// ---------------------------------------------------------------------------

roomsRouter.post("/", async (req, res) => {
  const displayName = validateDisplayName(req.body?.displayName);

  // Generate a unique room code — retry up to 5 times on the (extremely rare)
  // collision before giving up.
  let code = "";
  let attempts = 0;
  while (attempts < 5) {
    const candidate = generateRoomCode();
    const existing = await prisma.room.findUnique({ where: { code: candidate } });
    if (!existing) {
      code = candidate;
      break;
    }
    attempts++;
  }

  if (!code) {
    throw conflict("ROOM_CODE_EXHAUSTED", "Could not generate a unique room code. Please try again.");
  }

  // Room + host participant created atomically.
  const { room, participant } = await prisma.$transaction(async (tx) => {
    const room = await tx.room.create({
      data: { code },
    });

    const participant = await tx.participant.create({
      data: {
        displayName,
        role: "HOST",
        roomId: room.id,
      },
    });

    return { room, participant };
  });

  res.status(201).json({
    room: {
      id: room.id,
      code: room.code,
      status: room.status,
    },
    participant: {
      id: participant.id,
      displayName: participant.displayName,
      role: participant.role,
    },
  });
});
