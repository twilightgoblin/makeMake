import type WebSocket from "ws";
import { type ClientEnvelope } from "../../lib/wsTypes.js";
export declare function handleChat(socket: WebSocket, participantId: string, roomId: string, envelope: ClientEnvelope): Promise<void>;
//# sourceMappingURL=chat.d.ts.map