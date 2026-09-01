"use strict";
// -----------------------------------------------------------------------------
// Makemake — WebSocket protocol types
//
// Every message over the wire uses the same outer envelope:
//
//   Client → Server:  { type, requestId?, payload }
//   Server → Client:  { type, payload, timestamp }
//
// This file defines the discriminated unions for both directions, plus the
// error event shape and all valid error codes.
// -----------------------------------------------------------------------------
Object.defineProperty(exports, "__esModule", { value: true });
exports.makeServerEvent = makeServerEvent;
exports.makeErrorEvent = makeErrorEvent;
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
/** Build a server-side envelope ready for JSON serialization */
function makeServerEvent(type, payload) {
    return { type, payload, timestamp: new Date().toISOString() };
}
/** Build an ERROR envelope */
function makeErrorEvent(code, message, requestId) {
    return makeServerEvent("ERROR", { code, message, requestId });
}
//# sourceMappingURL=wsTypes.js.map