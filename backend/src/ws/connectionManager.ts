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

import type WebSocket from "ws";
import { makeServerEvent } from "../lib/wsTypes.js";
import type { ServerEnvelope } from "../lib/wsTypes.js";

export interface ConnectionRecord {
  socket: WebSocket;
  roomId: string;
  participantId: string;
  displayName: string;
  role: "HOST" | "MEMBER";
}

// participantId → ConnectionRecord
const byParticipant = new Map<string, ConnectionRecord>();

// roomId → Set of participantIds
const byRoom = new Map<string, Set<string>>();

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
const pendingHostTransfers = new Map<string, ReturnType<typeof setTimeout>>();

export function setPendingTransfer(
  participantId: string,
  timer: ReturnType<typeof setTimeout>,
): void {
  pendingHostTransfers.set(participantId, timer);
}

export function clearPendingTransfer(participantId: string): void {
  const timer = pendingHostTransfers.get(participantId);
  if (timer !== undefined) {
    clearTimeout(timer);
    pendingHostTransfers.delete(participantId);
  }
}

export function hasPendingTransfer(participantId: string): boolean {
  return pendingHostTransfers.has(participantId);
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export function addConnection(record: ConnectionRecord): void {
  byParticipant.set(record.participantId, record);

  let room = byRoom.get(record.roomId);
  if (!room) {
    room = new Set();
    byRoom.set(record.roomId, room);
  }
  room.add(record.participantId);
}

export function removeConnection(participantId: string): ConnectionRecord | undefined {
  const record = byParticipant.get(participantId);
  if (!record) return undefined;

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
export function updateRole(participantId: string, role: "HOST" | "MEMBER"): void {
  const record = byParticipant.get(participantId);
  if (record) {
    record.role = role;
  }
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function getConnection(participantId: string): ConnectionRecord | undefined {
  return byParticipant.get(participantId);
}

export function getRoomConnections(roomId: string): ConnectionRecord[] {
  const ids = byRoom.get(roomId);
  if (!ids || ids.size === 0) return [];

  const result: ConnectionRecord[] = [];
  for (const pid of ids) {
    const rec = byParticipant.get(pid);
    if (rec) result.push(rec);
  }
  return result;
}

export function getRoomParticipantIds(roomId: string): string[] {
  const ids = byRoom.get(roomId);
  return ids ? Array.from(ids) : [];
}

/** Is a participant currently connected (has an open socket)? */
export function isConnected(participantId: string): boolean {
  return byParticipant.has(participantId);
}

// ---------------------------------------------------------------------------
// Broadcast helpers
// ---------------------------------------------------------------------------

/** Send a serialised envelope to a single socket, silently skipping if closed. */
export function sendTo(socket: WebSocket, envelope: ServerEnvelope): void {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(envelope));
  }
}

/** Broadcast an envelope to every connected participant in a room. */
export function broadcastToRoom<T>(roomId: string, envelope: ServerEnvelope<T>): void {
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
export function broadcastToRoomExcept<T>(
  roomId: string,
  excludeParticipantId: string,
  envelope: ServerEnvelope<T>,
): void {
  const connections = getRoomConnections(roomId);
  const data = JSON.stringify(envelope);
  for (const { socket, participantId } of connections) {
    if (participantId !== excludeParticipantId && socket.readyState === socket.OPEN) {
      socket.send(data);
    }
  }
}

// Re-export makeServerEvent so handler files have a single import point.
export { makeServerEvent };
