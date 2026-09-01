"use strict";
// -----------------------------------------------------------------------------
// Makemake — Distributed host-transfer grace period
//
// Problem it solves (Phase 8.2):
//   The original implementation stored the reconnect grace flag in process
//   memory (pendingHostTransfers Map in connectionManager.ts). This worked
//   when every connection hit the same instance, but breaks under a load
//   balancer: the HOST could disconnect from S1, start the timer there, then
//   reconnect to S2. S2's clearPendingTransfer() call is a no-op (its Map is
//   empty), so S1's timer fires and erroneously promotes another participant.
//
// Solution:
//   Store the grace-period flag in Redis with the same TTL as the grace window.
//
//   Key:   host:grace:<participantId>
//   Value: "1"
//   TTL:   WS_RECONNECT_GRACE_MS / 1000  (rounded up to nearest second)
//
//   On disconnect  → SET host:grace:<id>  EX <graceSecs>
//   On reconnect   → DEL host:grace:<id>
//   Before transfer → GET host:grace:<id>  — if missing, HOST reconnected;
//                     abort the transfer regardless of which instance set the key.
//
// The in-process setTimeout still drives the transfer attempt (cheap, no
// extra Redis polling). Redis is only the cross-instance guard.
// -----------------------------------------------------------------------------
Object.defineProperty(exports, "__esModule", { value: true });
exports.hostGraceKey = hostGraceKey;
exports.armHostGrace = armHostGrace;
exports.cancelHostGrace = cancelHostGrace;
exports.isHostGraceActive = isHostGraceActive;
const redis_js_1 = require("./redis.js");
// ---------------------------------------------------------------------------
// Key helper
// ---------------------------------------------------------------------------
function hostGraceKey(participantId) {
    return `host:grace:${participantId}`;
}
// ---------------------------------------------------------------------------
// TTL helper — always read from process.env at call time so tests can override.
// ---------------------------------------------------------------------------
function graceSecs() {
    const ms = Number(process.env["WS_RECONNECT_GRACE_MS"] ?? 8000);
    // Minimum 1 second so we never accidentally SET with EX 0 (which would
    // immediately expire and make the guard unreliable).
    return Math.max(1, Math.ceil(ms / 1000));
}
// ---------------------------------------------------------------------------
// Write operations
// ---------------------------------------------------------------------------
/**
 * Arm the grace period for a HOST that just disconnected.
 * Any instance that later calls cancelHostGrace() within the TTL will prevent
 * the host transfer from firing.
 */
async function armHostGrace(participantId) {
    const secs = graceSecs();
    await (0, redis_js_1.getPublisher)().set(hostGraceKey(participantId), "1", "EX", secs);
}
/**
 * Cancel the grace period when the HOST reconnects.
 * Safe to call from any instance — the key is shared in Redis.
 */
async function cancelHostGrace(participantId) {
    await (0, redis_js_1.getPublisher)().del(hostGraceKey(participantId));
}
/**
 * Returns true if the grace period key still exists (HOST has NOT yet
 * reconnected on any instance).
 * Returns false if the key is gone — either the HOST reconnected and cancelled
 * it, or the TTL expired (same outcome: proceed with transfer).
 */
async function isHostGraceActive(participantId) {
    const exists = await (0, redis_js_1.getPublisher)().exists(hostGraceKey(participantId));
    return exists === 1;
}
//# sourceMappingURL=hostGrace.js.map