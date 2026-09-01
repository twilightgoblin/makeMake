/** Total TTL in seconds. Key expires this long after the last heartbeat. */
export declare const PRESENCE_TTL_SECS: number;
/** How often (ms) to refresh the TTL. Must be < PRESENCE_TTL_SECS * 1000. */
export declare const HEARTBEAT_INTERVAL_MS: number;
export declare function participantKey(participantId: string): string;
export declare function roomPresenceKey(roomId: string): string;
export interface PresenceRecord {
    participantId: string;
    roomId: string;
    serverId: string;
    connectedAt: string;
}
/**
 * Register a participant as present.
 * Sets the per-participant key with TTL and adds them to the room Set.
 */
export declare function registerPresence(participantId: string, roomId: string, serverId: string): Promise<void>;
/**
 * Refresh the TTL of an existing presence key (heartbeat).
 * No-op if the key has already expired (participant will need to re-register).
 */
export declare function refreshPresence(participantId: string): Promise<void>;
/**
 * Remove a participant's presence immediately (clean disconnect).
 * Also removes them from the room Set.
 */
export declare function removePresence(participantId: string, roomId: string): Promise<void>;
/**
 * Get the presence record for a single participant.
 * Returns null if they are not present (key expired or never registered).
 */
export declare function getPresence(participantId: string): Promise<PresenceRecord | null>;
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
export declare function getRoomPresence(roomId: string): Promise<PresenceRecord[]>;
/**
 * Check whether a specific participant is currently present anywhere.
 */
export declare function isPresent(participantId: string): Promise<boolean>;
//# sourceMappingURL=presence.d.ts.map