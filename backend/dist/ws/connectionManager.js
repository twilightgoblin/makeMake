"use strict";
// -----------------------------------------------------------------------------
// Makemake — In-memory WebSocket connection manager
//
// Two-way lookup:
//   roomId  → Set<participantId>          (who is in a room)
//   participantId → { socket, roomId }    (where a participant is)
//
// This is ephemeral process memory — no persistence, no Redis (Phase 3).
// All mutations are synchronous; the WS callbacks are already serialised per
// connection by Node's event loop.
// -----------------------------------------------------------------------------
Object.defineProperty(exports, "__esModule", { value: true });
exports.makeServerEvent = void 0;
exports.setPendingTransfer = setPendingTransfer;
exports.clearPendingTransfer = clearPendingTransfer;
exports.hasPendingTransfer = hasPendingTransfer;
exports.addConnection = addConnection;
exports.removeConnection = removeConnection;
exports.updateRole = updateRole;
exports.getConnection = getConnection;
exports.getRoomConnections = getRoomConnections;
exports.getRoomParticipantIds = getRoomParticipantIds;
exports.isConnected = isConnected;
exports.sendTo = sendTo;
exports.broadcastToRoom = broadcastToRoom;
exports.broadcastToRoomExcept = broadcastToRoomExcept;
const wsTypes_js_1 = require("../lib/wsTypes.js");
Object.defineProperty(exports, "makeServerEvent", { enumerable: true, get: function () { return wsTypes_js_1.makeServerEvent; } });
// participantId → ConnectionRecord
const byParticipant = new Map();
// roomId → Set of participantIds
const byRoom = new Map();
// ---------------------------------------------------------------------------
// Reconnect grace-period timers
//
// When a HOST disconnects, we don't immediately transfer their role. Instead
// we set a timer here. If the same participantId reconnects before the timer
// fires, we cancel it and they keep their role. If the timer fires first, the
// host-transfer logic runs as normal.
//
// The grace period is configurable via WS_RECONNECT_GRACE_MS (default 8 s).
// Tests set it to 0 so existing HOST_CHANGED behaviour is unchanged.
// ---------------------------------------------------------------------------
// participantId → pending host-transfer timer
const pendingHostTransfers = new Map();
function setPendingTransfer(participantId, timer) {
    pendingHostTransfers.set(participantId, timer);
}
function clearPendingTransfer(participantId) {
    const timer = pendingHostTransfers.get(participantId);
    if (timer !== undefined) {
        clearTimeout(timer);
        pendingHostTransfers.delete(participantId);
    }
}
function hasPendingTransfer(participantId) {
    return pendingHostTransfers.has(participantId);
}
// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------
function addConnection(record) {
    byParticipant.set(record.participantId, record);
    let room = byRoom.get(record.roomId);
    if (!room) {
        room = new Set();
        byRoom.set(record.roomId, room);
    }
    room.add(record.participantId);
}
function removeConnection(participantId) {
    const record = byParticipant.get(participantId);
    if (!record)
        return undefined;
    byParticipant.delete(participantId);
    const room = byRoom.get(record.roomId);
    if (room) {
        room.delete(participantId);
        if (room.size === 0) {
            byRoom.delete(record.roomId);
        }
    }
    return record;
}
/** Update the cached role for a participant (e.g. after host transfer). */
function updateRole(participantId, role) {
    const record = byParticipant.get(participantId);
    if (record) {
        record.role = role;
    }
}
// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------
function getConnection(participantId) {
    return byParticipant.get(participantId);
}
function getRoomConnections(roomId) {
    const ids = byRoom.get(roomId);
    if (!ids || ids.size === 0)
        return [];
    const result = [];
    for (const pid of ids) {
        const rec = byParticipant.get(pid);
        if (rec)
            result.push(rec);
    }
    return result;
}
function getRoomParticipantIds(roomId) {
    const ids = byRoom.get(roomId);
    return ids ? Array.from(ids) : [];
}
/** Is a participant currently connected (has an open socket)? */
function isConnected(participantId) {
    return byParticipant.has(participantId);
}
// ---------------------------------------------------------------------------
// Broadcast helpers
// ---------------------------------------------------------------------------
/** Send a serialised envelope to a single socket, silently skipping if closed. */
function sendTo(socket, envelope) {
    if (socket.readyState === socket.OPEN) {
        socket.send(JSON.stringify(envelope));
    }
}
/** Broadcast an envelope to every connected participant in a room. */
function broadcastToRoom(roomId, envelope) {
    const connections = getRoomConnections(roomId);
    const data = JSON.stringify(envelope);
    for (const { socket } of connections) {
        if (socket.readyState === socket.OPEN) {
            socket.send(data);
        }
    }
}
/**
 * Broadcast to a room, but skip one participant (e.g. the sender).
 * Useful when the initiating client will apply the change optimistically.
 */
function broadcastToRoomExcept(roomId, excludeParticipantId, envelope) {
    const connections = getRoomConnections(roomId);
    const data = JSON.stringify(envelope);
    for (const { socket, participantId } of connections) {
        if (participantId !== excludeParticipantId && socket.readyState === socket.OPEN) {
            socket.send(data);
        }
    }
}
//# sourceMappingURL=connectionManager.js.map