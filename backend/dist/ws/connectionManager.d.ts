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
export declare function setPendingTransfer(participantId: string, timer: ReturnType<typeof setTimeout>): void;
export declare function clearPendingTransfer(participantId: string): void;
export declare function hasPendingTransfer(participantId: string): boolean;
export declare function addConnection(record: ConnectionRecord): void;
export declare function removeConnection(participantId: string): ConnectionRecord | undefined;
/** Update the cached role for a participant (e.g. after host transfer). */
export declare function updateRole(participantId: string, role: "HOST" | "MEMBER"): void;
export declare function getConnection(participantId: string): ConnectionRecord | undefined;
export declare function getRoomConnections(roomId: string): ConnectionRecord[];
export declare function getRoomParticipantIds(roomId: string): string[];
/** Is a participant currently connected (has an open socket)? */
export declare function isConnected(participantId: string): boolean;
/** Send a serialised envelope to a single socket, silently skipping if closed. */
export declare function sendTo(socket: WebSocket, envelope: ServerEnvelope): void;
/** Broadcast an envelope to every connected participant in a room. */
export declare function broadcastToRoom<T>(roomId: string, envelope: ServerEnvelope<T>): void;
/**
 * Broadcast to a room, but skip one participant (e.g. the sender).
 * Useful when the initiating client will apply the change optimistically.
 */
export declare function broadcastToRoomExcept<T>(roomId: string, excludeParticipantId: string, envelope: ServerEnvelope<T>): void;
export { makeServerEvent };
//# sourceMappingURL=connectionManager.d.ts.map