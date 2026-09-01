"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.roomLifecycleRouter = void 0;
const express_1 = require("express");
const prisma_js_1 = require("../lib/prisma.js");
const requireParticipant_js_1 = require("../middleware/requireParticipant.js");
const requireHost_js_1 = require("../middleware/requireHost.js");
const errors_js_1 = require("../lib/errors.js");
const connectionManager_js_1 = require("../ws/connectionManager.js");
const wsTypes_js_1 = require("../lib/wsTypes.js");
const roomEvents_js_1 = require("../lib/roomEvents.js");
const roomExpiry_js_1 = require("../lib/roomExpiry.js");
exports.roomLifecycleRouter = (0, express_1.Router)();
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
exports.roomLifecycleRouter.delete("/:id", requireParticipant_js_1.requireParticipant, requireHost_js_1.requireHost, async (req, res) => {
    const roomId = String(req.params["id"]);
    const room = await prisma_js_1.prisma.room.findUnique({ where: { id: roomId } });
    if (!room) {
        throw (0, errors_js_1.notFound)("Room");
    }
    if (room.status === "CLOSED") {
        throw new errors_js_1.AppError(409, "ROOM_ALREADY_CLOSED", "This room is already closed.");
    }
    const updated = await prisma_js_1.prisma.room.update({
        where: { id: roomId },
        data: { status: "CLOSED" },
    });
    // Notify all connected participants that the room is closed.
    await (0, roomEvents_js_1.publishRoomEvent)(roomId, (0, wsTypes_js_1.makeServerEvent)("ROOM_CLOSED", {}));
    // Room is explicitly CLOSED — no TTL needed (already final state).
    await (0, roomExpiry_js_1.cancelRoomExpiry)(roomId);
    res.json({ room: { id: updated.id, status: updated.status } });
});
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
exports.roomLifecycleRouter.patch("/:id/participants/:participantId/leave", requireParticipant_js_1.requireParticipant, async (req, res) => {
    const roomId = String(req.params["id"]);
    const participantId = String(req.params["participantId"]);
    const caller = res.locals["participant"];
    // You can only leave as yourself.
    if (caller.id !== participantId) {
        throw new errors_js_1.AppError(403, "FORBIDDEN", "You can only remove yourself from a room.");
    }
    if (caller.leftAt !== null) {
        throw new errors_js_1.AppError(409, "ALREADY_LEFT", "You have already left this room.");
    }
    const now = new Date();
    // Mark the participant as having left.
    const updated = await prisma_js_1.prisma.participant.update({
        where: { id: participantId },
        data: { leftAt: now },
    });
    // Broadcast USER_LEFT so connected clients update their participant list.
    await (0, roomEvents_js_1.publishRoomEvent)(roomId, (0, wsTypes_js_1.makeServerEvent)("USER_LEFT", {
        participantId,
        displayName: caller.displayName,
    }));
    // Find remaining active participants in join-order.
    const remaining = await prisma_js_1.prisma.participant.findMany({
        where: { roomId, leftAt: null },
        orderBy: { joinedAt: "asc" },
    });
    console.log(`[roomLifecycle] leave roomId=${roomId} participantId=${participantId} role=${caller.role} remaining=${remaining.length}`);
    console.log(`[roomLifecycle] leave roomId=${roomId} participantId=${participantId} role=${caller.role} remaining=${remaining.length}`);
    let newHost = null;
    let roomStatus = "ACTIVE";
    if (remaining.length === 0) {
        // Last person left → room goes INACTIVE → arm expiry TTL.
        roomStatus = "INACTIVE";
        await prisma_js_1.prisma.room.update({
            where: { id: roomId },
            data: { status: "INACTIVE" },
        });
        await (0, roomExpiry_js_1.setRoomExpiry)(roomId);
    }
    else if (caller.role === "HOST") {
        // HOST left but others remain → transfer to earliest-joined *connected* participant.
        // Prefer someone with an active WebSocket; fall back to any DB member.
        const connectedRemaining = remaining.filter((p) => (0, connectionManager_js_1.isConnected)(p.id));
        const candidates = connectedRemaining.length > 0 ? connectedRemaining : remaining;
        newHost = candidates[0];
        await prisma_js_1.prisma.participant.update({
            where: { id: newHost.id },
            data: { role: "HOST" },
        });
        // Demote the leaving participant in DB (they may reconnect later as MEMBER)
        await prisma_js_1.prisma.participant.update({
            where: { id: participantId },
            data: { role: "MEMBER" },
        });
        // Sync in-memory role cache
        (0, connectionManager_js_1.updateRole)(newHost.id, "HOST");
        // Broadcast HOST_CHANGED so connected clients update immediately
        await (0, roomEvents_js_1.publishRoomEvent)(roomId, (0, wsTypes_js_1.makeServerEvent)("HOST_CHANGED", {
            newHostId: newHost.id,
            newHostDisplayName: newHost.displayName,
        }));
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
});
//# sourceMappingURL=roomLifecycle.js.map