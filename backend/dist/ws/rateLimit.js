"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.wsRateLimit = wsRateLimit;
const rateLimit_js_1 = require("../lib/rateLimit.js");
const wsTypes_js_1 = require("../lib/wsTypes.js");
/**
 * Checks the WS rate limit and sends an ERROR message if exceeded.
 * @returns true if allowed, false if rate limited (error already sent).
 */
async function wsRateLimit(ws, key, limit, windowMs) {
    const allowed = await (0, rateLimit_js_1.checkRateLimit)(key, limit, windowMs);
    if (!allowed) {
        const errorMsg = (0, wsTypes_js_1.makeErrorEvent)("RATE_LIMITED", "Too many requests. Please try again later.");
        ws.send(JSON.stringify(errorMsg));
        return false;
    }
    return true;
}
//# sourceMappingURL=rateLimit.js.map