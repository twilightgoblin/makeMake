"use strict";
// -----------------------------------------------------------------------------
// Makemake — Room-event Pub/Sub
//
// This module is the single cross-instance broadcast path.
//
// Architecture:
//
//   Handler
//     │ publishRoomEvent(roomId, serverEnvelope)
//     ▼
//   Redis PUBLISH  room-events:<roomId>
//     │
//     ├── Server 1 subscriber  →  broadcastToRoom() → local sockets
//     └── Server 2 subscriber  →  broadcastToRoom() → local sockets
//
// Key design rules:
//   1. Handlers call publishRoomEvent() instead of broadcastToRoom() directly.
//   2. The subscriber is the ONLY place broadcastToRoom() is called for
//      room-scoped events. This prevents the originating server from
//      double-broadcasting (publish fires back to itself via Redis).
//   3. For point-to-point sends (sendTo / broadcastToRoomExcept targeted at a
//      specific socket that is guaranteed local) the caller uses connectionManager
//      directly — those don't need cross-instance delivery.
//
// Channel naming:
//   room-events:<roomId>
//
// Wire format:
//   Plain JSON string of RoomEventEnvelope.
// -----------------------------------------------------------------------------
Object.defineProperty(exports, "__esModule", { value: true });
exports.publishRoomEvent = publishRoomEvent;
exports.subscribeRoomEvents = subscribeRoomEvents;
const redis_js_1 = require("./redis.js");
const connectionManager_js_1 = require("../ws/connectionManager.js");
// ---------------------------------------------------------------------------
// Channel helper
// ---------------------------------------------------------------------------
function channel(roomId) {
    return `room-events:${roomId}`;
}
// ---------------------------------------------------------------------------
// Publisher
//
// Serialises the envelope and publishes to the room's channel.
// Returns the number of subscribers that received the message (ioredis
// resolves with the Redis PUBLISH reply count — useful for debugging).
// ---------------------------------------------------------------------------
async function publishRoomEvent(roomId, event, excludeParticipantId) {
    const envelope = {
        roomId,
        event,
        ...(excludeParticipantId !== undefined && { excludeParticipantId }),
    };
    await (0, redis_js_1.getPublisher)().publish(channel(roomId), JSON.stringify(envelope));
}
// ---------------------------------------------------------------------------
// Subscriber
//
// Called once per server process at startup. Subscribes to a pattern that
// covers all room channels so a single subscription handles every room.
//
// Pattern: room-events:*
//
// On each message the subscriber parses the envelope and calls the
// appropriate local broadcast helper. Only sockets registered on THIS
// instance are reached — that is correct and intentional.
// ---------------------------------------------------------------------------
function subscribeRoomEvents() {
    const sub = (0, redis_js_1.getSubscriber)();
    sub.psubscribe("room-events:*", (err) => {
        if (err) {
            console.error("[redis:sub] psubscribe failed", err);
        }
        else {
            console.log("[redis:sub] subscribed to room-events:*");
        }
    });
    sub.on("pmessage", (_pattern, _channel, message) => {
        let envelope;
        try {
            envelope = JSON.parse(message);
        }
        catch (err) {
            console.error("[redis:sub] failed to parse message", err);
            return;
        }
        const { roomId, event, excludeParticipantId } = envelope;
        if (excludeParticipantId !== undefined) {
            (0, connectionManager_js_1.broadcastToRoomExcept)(roomId, excludeParticipantId, event);
        }
        else {
            (0, connectionManager_js_1.broadcastToRoom)(roomId, event);
        }
    });
}
//# sourceMappingURL=roomEvents.js.map