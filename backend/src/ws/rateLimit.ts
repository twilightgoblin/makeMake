import { checkRateLimit } from "../lib/rateLimit.js";
import { WebSocket } from "ws";
import { makeErrorEvent } from "../lib/wsTypes.js";

/**
 * Checks the WS rate limit and sends an ERROR message if exceeded.
 * @returns true if allowed, false if rate limited (error already sent).
 */
export async function wsRateLimit(
  ws: WebSocket,
  key: string,
  limit: number,
  windowMs: number
): Promise<boolean> {
  const allowed = await checkRateLimit(key, limit, windowMs);
  if (!allowed) {
    const errorMsg = makeErrorEvent("RATE_LIMITED", "Too many requests. Please try again later.");
    ws.send(JSON.stringify(errorMsg));
    return false;
  }
  return true;
}
