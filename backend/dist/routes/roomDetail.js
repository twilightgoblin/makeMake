"use strict";
// -----------------------------------------------------------------------------
// Makemake — Room detail route
//
// GET /rooms/:id — returns full room state for an active participant.
// This is the hydration endpoint: a client connects here before opening the
// WebSocket so it has current playback state, participants, and playlist.
// -----------------------------------------------------------------------------
Object.defineProperty(exports, "__esModule", { value: true });
exports.roomDetailRouter = void 0;
const express_1 = require("express");
const prisma_js_1 = require("../lib/prisma.js");
const requireParticipant_js_1 = require("../middleware/requireParticipant.js");
const connectionManager_js_1 = require("../ws/connectionManager.js");
exports.roomDetailRouter = (0, express_1.Router)();
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
exports.roomDetailRouter.get("/:id", requireParticipant_js_1.requireParticipant, async (req, res) => {
    const roomId = String(req.params["id"]);
    const caller = res.locals["participant"];
    // Fetch core room data + active participants in one query.
    const room = await prisma_js_1.prisma.room.findUnique({
        where: { id: roomId },
        include: {
            currentSong: {
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
    const pendingJoinRequests = caller.role === "HOST"
        ? await prisma_js_1.prisma.joinRequest.findMany({
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
                isOnline: (0, connectionManager_js_1.isConnected)(p.id),
            })),
            ...(pendingJoinRequests !== undefined && { pendingJoinRequests }),
        },
    });
});
//# sourceMappingURL=roomDetail.js.map