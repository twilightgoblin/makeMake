import { WebSocket } from "ws";
/**
 * Checks the WS rate limit and sends an ERROR message if exceeded.
 * @returns true if allowed, false if rate limited (error already sent).
 */
export declare function wsRateLimit(ws: WebSocket, key: string, limit: number, windowMs: number): Promise<boolean>;
//# sourceMappingURL=rateLimit.d.ts.map