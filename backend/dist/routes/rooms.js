"use strict";
// -----------------------------------------------------------------------------
// Makemake — /rooms routes
// POST /rooms  — create a room + host participant in one transaction
// -----------------------------------------------------------------------------
Object.defineProperty(exports, "__esModule", { value: true });
exports.roomsRouter = void 0;
const express_1 = require("express");
const prisma_js_1 = require("../lib/prisma.js");
const validate_js_1 = require("../lib/validate.js");
const roomCode_js_1 = require("../lib/roomCode.js");
const errors_js_1 = require("../lib/errors.js");
const rateLimit_js_1 = require("../middleware/rateLimit.js");
exports.roomsRouter = (0, express_1.Router)();
// Rate limiter for room creation: 5 requests per minute per IP
const createRoomLimiter = (0, rateLimit_js_1.rateLimit)({
    limit: 5,
    windowMs: 60 * 1000,
    keyGenerator: (req) => `rate-limit:create-room:${req.ip}`,
});
// ---------------------------------------------------------------------------
// POST /rooms
// Body: { displayName: string }
// Response 201: { room: { id, code, status }, participant: { id, displayName, role } }
// ---------------------------------------------------------------------------
exports.roomsRouter.post("/", createRoomLimiter, async (req, res) => {
    const displayName = (0, validate_js_1.validateDisplayName)(req.body?.displayName);
    // Generate a unique room code — retry up to 5 times on the (extremely rare)
    // collision before giving up.
    let code = "";
    let attempts = 0;
    while (attempts < 5) {
        const candidate = (0, roomCode_js_1.generateRoomCode)();
        const existing = await prisma_js_1.prisma.room.findUnique({ where: { code: candidate } });
        if (!existing) {
            code = candidate;
            break;
        }
        attempts++;
    }
    if (!code) {
        throw (0, errors_js_1.conflict)("ROOM_CODE_EXHAUSTED", "Could not generate a unique room code. Please try again.");
    }
    // Room + host participant created atomically.
    const { room, participant } = await prisma_js_1.prisma.$transaction(async (tx) => {
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
//# sourceMappingURL=rooms.js.map