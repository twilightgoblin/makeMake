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

import { getPublisher } from "./redis.js";

// ---------------------------------------------------------------------------
// Key helper
// ---------------------------------------------------------------------------

export function hostGraceKey(participantId: string): string {
  return `host:grace:${participantId}`;
}

// ---------------------------------------------------------------------------
// TTL helper — always read from process.env at call time so tests can override.
// ---------------------------------------------------------------------------

function graceSecs(): number {
  const ms = Number(process.env["WS_RECONNECT_GRACE_MS"] ?? 8_000);
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
export async function armHostGrace(participantId: string): Promise<void> {
  const secs = graceSecs();
  await getPublisher().set(hostGraceKey(participantId), "1", "EX", secs);
}

/**
 * Cancel the grace period when the HOST reconnects.
 * Safe to call from any instance — the key is shared in Redis.
 */
export async function cancelHostGrace(participantId: string): Promise<void> {
  await getPublisher().del(hostGraceKey(participantId));
}

/**
 * Returns true if the grace period key still exists (HOST has NOT yet
 * reconnected on any instance).
 * Returns false if the key is gone — either the HOST reconnected and cancelled
 * it, or the TTL expired (same outcome: proceed with transfer).
 */
export async function isHostGraceActive(participantId: string): Promise<boolean> {
  const exists = await getPublisher().exists(hostGraceKey(participantId));
  return exists === 1;
}
