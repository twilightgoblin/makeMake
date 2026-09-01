// -----------------------------------------------------------------------------
// Makemake — Distributed presence
//
// Responsibility split:
//   PostgreSQL  →  who *belongs* to a room (Participant rows)
//   Redis keys  →  who is *currently connected* (presence entries + TTL)
//
// Key schema:
//   presence:participant:<participantId>
//
// Value: JSON  { participantId, roomId, serverId, connectedAt }
//
// TTL: PRESENCE_TTL_SECS (default 30 s). The heartbeat refreshes the key
// every PRESENCE_TTL_SECS / 2 seconds so active connections never expire.
// An unexpected disconnect (crash, network drop) causes the key to naturally
// expire after one full TTL window.
//
// Room index:
//   presence:room:<roomId>   →  Redis Set of participantIds
//
// The Set lets getRoomPresence() fetch all present participants for a room
// with two Redis round-trips (SMEMBERS + N GETs) instead of a SCAN.
// Each Set member is removed on clean disconnect and naturally becomes stale
// if the process dies — callers should cross-check against the per-participant
// keys and discard members whose key has expired.
// -----------------------------------------------------------------------------

import { getPublisher } from "./redis.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Total TTL in seconds. Key expires this long after the last heartbeat. */
export const PRESENCE_TTL_SECS = Number(process.env["PRESENCE_TTL_SECS"] ?? 30);

/** How often (ms) to refresh the TTL. Must be < PRESENCE_TTL_SECS * 1000. */
export const HEARTBEAT_INTERVAL_MS = Math.floor((PRESENCE_TTL_SECS * 1000) / 2);

// ---------------------------------------------------------------------------
// Key helpers
// ---------------------------------------------------------------------------

export function participantKey(participantId: string): string {
  return `presence:participant:${participantId}`;
}

export function roomPresenceKey(roomId: string): string {
  return `presence:room:${roomId}`;
}

// ---------------------------------------------------------------------------
// Presence record shape
// ---------------------------------------------------------------------------

export interface PresenceRecord {
  participantId: string;
  roomId: string;
  serverId: string;
  connectedAt: string; // ISO timestamp
}

// ---------------------------------------------------------------------------
// Write operations  (all use getPublisher() — normal commands, not sub)
// ---------------------------------------------------------------------------

/**
 * Register a participant as present.
 * Sets the per-participant key with TTL and adds them to the room Set.
 */
export async function registerPresence(
  participantId: string,
  roomId: string,
  serverId: string,
): Promise<void> {
  const record: PresenceRecord = {
    participantId,
    roomId,
    serverId,
    connectedAt: new Date().toISOString(),
  };

  const redis = getPublisher();

  // SET with EX — atomic
  await redis.set(
    participantKey(participantId),
    JSON.stringify(record),
    "EX",
    PRESENCE_TTL_SECS,
  );

  // Add to room Set; give the Set a TTL slightly longer than the per-key TTL
  // so it outlives individual members (cleaned up on expiry scan or next use).
  await redis.sadd(roomPresenceKey(roomId), participantId);
  await redis.expire(roomPresenceKey(roomId), PRESENCE_TTL_SECS * 10);
}

/**
 * Refresh the TTL of an existing presence key (heartbeat).
 * No-op if the key has already expired (participant will need to re-register).
 */
export async function refreshPresence(participantId: string): Promise<void> {
  await getPublisher().expire(participantKey(participantId), PRESENCE_TTL_SECS);
}

/**
 * Remove a participant's presence immediately (clean disconnect).
 * Also removes them from the room Set.
 */
export async function removePresence(
  participantId: string,
  roomId: string,
): Promise<void> {
  const redis = getPublisher();
  await redis.del(participantKey(participantId));
  await redis.srem(roomPresenceKey(roomId), participantId);
}

// ---------------------------------------------------------------------------
// Read operations
// ---------------------------------------------------------------------------

/**
 * Get the presence record for a single participant.
 * Returns null if they are not present (key expired or never registered).
 */
export async function getPresence(
  participantId: string,
): Promise<PresenceRecord | null> {
  const raw = await getPublisher().get(participantKey(participantId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PresenceRecord;
  } catch {
    return null;
  }
}

/**
 * Get all currently present participants for a room.
 *
 * Strategy:
 *   1. SMEMBERS on the room Set to get candidate participantIds
 *   2. MGET all per-participant keys in one round-trip
 *   3. Drop any null entries (key expired — stale Set member)
 *   4. Clean stale members from the Set (fire-and-forget)
 *
 * Returns an array of live PresenceRecords.
 */
export async function getRoomPresence(roomId: string): Promise<PresenceRecord[]> {
  const redis = getPublisher();
  const members = await redis.smembers(roomPresenceKey(roomId));

  if (members.length === 0) return [];

  // Fetch all per-participant keys in one MGET
  const keys = members.map(participantKey);
  const values = await redis.mget(...keys);

  const results: PresenceRecord[] = [];
  const stale: string[] = [];

  for (let i = 0; i < members.length; i++) {
    const raw = values[i];
    if (raw === null) {
      // Key has expired — TTL ran out without a heartbeat
      stale.push(members[i]!);
    } else {
      try {
        results.push(JSON.parse(raw) as PresenceRecord);
      } catch {
        stale.push(members[i]!);
      }
    }
  }

  // Prune stale members from the Set (best-effort, fire and forget)
  if (stale.length > 0) {
    void redis.srem(roomPresenceKey(roomId), ...stale);
  }

  return results;
}

/**
 * Check whether a specific participant is currently present anywhere.
 */
export async function isPresent(participantId: string): Promise<boolean> {
  const exists = await getPublisher().exists(participantKey(participantId));
  return exists === 1;
}
