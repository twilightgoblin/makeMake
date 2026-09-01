/**
 * TTL in seconds for INACTIVE rooms.
 * Always read from process.env at call time — never cached as a module
 * constant — so the value is consistent regardless of CJS module caching.
 *
 * configureRoomExpiry() is kept for explicit startup logging only;
 * setRoomExpiry() reads directly from process.env.
 */
export declare function getRoomInactiveTtlSecs(): number;
/** Call once at startup for an explicit log line. Does not affect TTL reads. */
export declare function configureRoomExpiry(ttlSecs: number): void;
export declare function roomExpiryKey(roomId: string): string;
export declare function setRoomExpiry(roomId: string): Promise<void>;
export declare function cancelRoomExpiry(roomId: string): Promise<void>;
export declare function getRoomExpiryTtl(roomId: string): Promise<number | null>;
export declare function subscribeRoomExpiry(): Promise<void>;
export declare function rearmInactiveRooms(): Promise<void>;
//# sourceMappingURL=roomExpiry.d.ts.map