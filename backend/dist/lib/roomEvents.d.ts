import type { ServerEnvelope } from "./wsTypes.js";
export interface RoomEventEnvelope<T = unknown> {
    roomId: string;
    excludeParticipantId?: string;
    event: ServerEnvelope<T>;
}
export declare function publishRoomEvent<T>(roomId: string, event: ServerEnvelope<T>, excludeParticipantId?: string): Promise<void>;
export declare function subscribeRoomEvents(): void;
//# sourceMappingURL=roomEvents.d.ts.map