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

import { getPublisher, getSubscriber } from "./redis.js";
import { broadcastToRoom, broadcastToRoomExcept } from "../ws/connectionManager.js";
import type { ServerEnvelope, ServerEventType } from "./wsTypes.js";

// ---------------------------------------------------------------------------
// RoomEventEnvelope — what travels over Redis
//
// We wrap the existing ServerEnvelope with two extra fields:
//   roomId     — subscriber needs to know which room to broadcast to
//   excludeId  — optional participantId to skip (for USER_JOINED which uses
//                broadcastToRoomExcept so the joiner doesn't get a duplicate)
// ---------------------------------------------------------------------------

export interface RoomEventEnvelope<T = unknown> {
  roomId: string;
  excludeParticipantId?: string;
  event: ServerEnvelope<T>;
}

// ---------------------------------------------------------------------------
// Channel helper
// ---------------------------------------------------------------------------

function channel(roomId: string): string {
  return `room-events:${roomId}`;
}

// ---------------------------------------------------------------------------
// Publisher
//
// Serialises the envelope and publishes to the room's channel.
// Returns the number of subscribers that received the message (ioredis
// resolves with the Redis PUBLISH reply count — useful for debugging).
// ---------------------------------------------------------------------------

export async function publishRoomEvent<T>(
  roomId: string,
  event: ServerEnvelope<T>,
  excludeParticipantId?: string,
): Promise<void> {
  const envelope: RoomEventEnvelope<T> = {
    roomId,
    event,
    ...(excludeParticipantId !== undefined && { excludeParticipantId }),
  };

  await getPublisher().publish(channel(roomId), JSON.stringify(envelope));
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

export function subscribeRoomEvents(): void {
  const sub = getSubscriber();

  sub.psubscribe("room-events:*", (err) => {
    if (err) {
      console.error("[redis:sub] psubscribe failed", err);
    } else {
      console.log("[redis:sub] subscribed to room-events:*");
    }
  });

  sub.on("pmessage", (_pattern: string, _channel: string, message: string) => {
    let envelope: RoomEventEnvelope;
    try {
      envelope = JSON.parse(message) as RoomEventEnvelope;
    } catch (err) {
      console.error("[redis:sub] failed to parse message", err);
      return;
    }

    const { roomId, event, excludeParticipantId } = envelope;

    if (excludeParticipantId !== undefined) {
      broadcastToRoomExcept(roomId, excludeParticipantId, event);
    } else {
      broadcastToRoom(roomId, event);
    }
  });
}
