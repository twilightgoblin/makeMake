"use strict";
// -----------------------------------------------------------------------------
// Makemake — Join-request routes
//
// POST  /rooms/:code/join-requests          — guest submits a join request
// GET   /rooms/:code/join-requests/:id      — requester polls their status
// PATCH /rooms/:id/join-requests/:requestId — host accepts or rejects
// -----------------------------------------------------------------------------
Object.defineProperty(exports, "__esModule", { value: true });
exports.joinRequestsRouter = void 0;
const express_1 = require("express");
const prisma_js_1 = require("../lib/prisma.js");
const validate_js_1 = require("../lib/validate.js");
const errors_js_1 = require("../lib/errors.js");
const requireParticipant_js_1 = require("../middleware/requireParticipant.js");
const requireHost_js_1 = require("../middleware/requireHost.js");
const connectionManager_js_1 = require("../ws/connectionManager.js");
const roomEvents_js_1 = require("../lib/roomEvents.js");
const roomExpiry_js_1 = require("../lib/roomExpiry.js");
const wsTypes_js_1 = require("../lib/wsTypes.js");
const rateLimit_js_1 = require("../middleware/rateLimit.js");
exports.joinRequestsRouter = (0, express_1.Router)();
// Rate limiter for join requests: 10 requests per minute per IP + room code
const joinRequestLimiter = (0, rateLimit_js_1.rateLimit)({
    limit: 10,
    windowMs: 60 * 1000,
    keyGenerator: (req) => `rate-limit:join-request:${req.params["code"]}:${req.ip}`,
});
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
exports.joinRequestsRouter.post("/:code/join-requests", joinRequestLimiter, async (req, res) => {
    const code = String(req.params["code"]);
    const displayName = (0, validate_js_1.validateDisplayName)(req.body?.displayName);
    const room = await prisma_js_1.prisma.room.findUnique({ where: { code } });
    if (!room) {
        throw (0, errors_js_1.notFound)("Room");
    }
    if (room.status === "CLOSED") {
        throw (0, errors_js_1.conflict)("ROOM_NOT_ACCEPTING", "This room is closed and no longer accepts join requests.");
    }
    if (room.status === "INACTIVE") {
        throw (0, errors_js_1.conflict)("ROOM_NOT_ACCEPTING", "This room is currently inactive.");
    }
    // Prevent duplicate pending requests (e.g. someone spam-clicking join).
    const existing = await prisma_js_1.prisma.joinRequest.findFirst({
        where: {
            roomId: room.id,
            displayName,
            status: "PENDING",
        },
    });
    if (existing) {
        throw (0, errors_js_1.conflict)("PENDING_REQUEST_EXISTS", "A pending join request with this display name already exists.");
    }
    const joinRequest = await prisma_js_1.prisma.joinRequest.create({
        data: {
            displayName,
            roomId: room.id,
        },
    });
    // Notify the HOST via WebSocket if they are currently connected.
    const roomConnections = (0, connectionManager_js_1.getRoomConnections)(room.id);
    const hostConnection = roomConnections.find((c) => c.role === "HOST");
    if (hostConnection) {
        const payload = {
            joinRequest: {
                id: joinRequest.id,
                displayName: joinRequest.displayName,
                status: "PENDING",
                roomId: joinRequest.roomId,
                createdAt: joinRequest.createdAt.toISOString(),
            },
        };
        (0, connectionManager_js_1.sendTo)(hostConnection.socket, (0, wsTypes_js_1.makeServerEvent)("JOIN_REQUEST", payload));
    }
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
// GET /rooms/:code/join-requests/:requestId
//
// The requester polls this to check if they have been accepted or rejected.
// No authentication required — the requester has no participant identity yet.
//
// Returns: 200 { joinRequest: { id, displayName, status, roomId, createdAt, resolvedAt } }
//
// Errors:
//   404 NOT_FOUND — no room with that code, or request not in that room
// ---------------------------------------------------------------------------
exports.joinRequestsRouter.get("/:code/join-requests/:requestId", async (req, res) => {
    const code = String(req.params["code"]);
    const requestId = String(req.params["requestId"]);
    const room = await prisma_js_1.prisma.room.findUnique({ where: { code } });
    if (!room) {
        throw (0, errors_js_1.notFound)("Room");
    }
    const joinRequest = await prisma_js_1.prisma.joinRequest.findFirst({
        where: { id: requestId, roomId: room.id },
    });
    if (!joinRequest) {
        throw (0, errors_js_1.notFound)("Join request");
    }
    // When accepted, look up the participant row so the joiner can get their id.
    let participant = null;
    if (joinRequest.status === "ACCEPTED") {
        participant = await prisma_js_1.prisma.participant.findFirst({
            where: { roomId: room.id, displayName: joinRequest.displayName, leftAt: null },
            select: { id: true, role: true },
        });
    }
    res.json({
        joinRequest: {
            id: joinRequest.id,
            displayName: joinRequest.displayName,
            status: joinRequest.status,
            roomId: joinRequest.roomId,
            createdAt: joinRequest.createdAt,
            resolvedAt: joinRequest.resolvedAt,
        },
        ...(participant && {
            participant: {
                id: participant.id,
                role: participant.role,
                roomId: room.id,
            },
        }),
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
exports.joinRequestsRouter.patch("/:id/join-requests/:requestId", requireParticipant_js_1.requireParticipant, requireHost_js_1.requireHost, async (req, res) => {
    const roomId = String(req.params["id"]);
    const requestId = String(req.params["requestId"]);
    const { action } = req.body ?? {};
    if (action !== "ACCEPT" && action !== "REJECT") {
        throw new errors_js_1.AppError(400, "INVALID_BODY", 'action must be either "ACCEPT" or "REJECT".');
    }
    const joinRequest = await prisma_js_1.prisma.joinRequest.findFirst({
        where: { id: requestId, roomId },
    });
    if (!joinRequest) {
        throw (0, errors_js_1.notFound)("Join request");
    }
    if (joinRequest.status !== "PENDING") {
        throw (0, errors_js_1.conflict)("REQUEST_NOT_PENDING", "This join request has already been resolved.");
    }
    if (action === "REJECT") {
        const updated = await prisma_js_1.prisma.joinRequest.update({
            where: { id: requestId },
            data: { status: "REJECTED", resolvedAt: new Date() },
        });
        // The requester polls for status — no WS notification needed since
        // they have no participant identity and no socket yet. The poll
        // endpoint will return REJECTED on their next check.
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
    const { updatedRequest, participant } = await prisma_js_1.prisma.$transaction(async (tx) => {
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
    // Broadcast JOIN_REQUEST_RESOLVED to everyone currently in the room so
    // existing participants know someone was accepted (they'll see them on
    // WS USER_JOINED once the new participant connects their socket).
    const resolvedPayload = {
        joinRequestId: updatedRequest.id,
        action: "ACCEPTED",
        participant: {
            id: participant.id,
            displayName: participant.displayName,
            role: participant.role,
            roomId: participant.roomId,
        },
    };
    // Room may have been INACTIVE (everyone had left). Cancel the expiry
    // timer now that it's being re-activated with a new participant.
    await (0, roomExpiry_js_1.cancelRoomExpiry)(roomId);
    await (0, roomEvents_js_1.publishRoomEvent)(roomId, (0, wsTypes_js_1.makeServerEvent)("JOIN_REQUEST_RESOLVED", resolvedPayload));
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
});
//# sourceMappingURL=joinRequests.js.map