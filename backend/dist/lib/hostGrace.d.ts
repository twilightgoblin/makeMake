export declare function hostGraceKey(participantId: string): string;
/**
 * Arm the grace period for a HOST that just disconnected.
 * Any instance that later calls cancelHostGrace() within the TTL will prevent
 * the host transfer from firing.
 */
export declare function armHostGrace(participantId: string): Promise<void>;
/**
 * Cancel the grace period when the HOST reconnects.
 * Safe to call from any instance — the key is shared in Redis.
 */
export declare function cancelHostGrace(participantId: string): Promise<void>;
/**
 * Returns true if the grace period key still exists (HOST has NOT yet
 * reconnected on any instance).
 * Returns false if the key is gone — either the HOST reconnected and cancelled
 * it, or the TTL expired (same outcome: proceed with transfer).
 */
export declare function isHostGraceActive(participantId: string): Promise<boolean>;
//# sourceMappingURL=hostGrace.d.ts.map