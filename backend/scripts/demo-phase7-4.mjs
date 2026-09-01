/**
 * Phase 7.4 — Room TTL / expiry demo
 *
 * Scenarios:
 *   1. INACTIVE → TTL fires → room CLOSED in PostgreSQL
 *   2. WS disconnect (not leave) does NOT arm the TTL (disconnect ≠ leave invariant)
 *   3. Restart recovery: rearmInactiveRooms() re-arms TTL for INACTIVE rooms
 *      that had no expiry key (simulating a crash before setRoomExpiry ran)
 *
 * Run with a short TTL:
 *   ROOM_INACTIVE_TTL_SECS=6 node scripts/demo-phase7-4.mjs
 */

import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import WebSocket from "ws";
import { execSync } from "node:child_process";

const S1  = "http://localhost:3000";
const TTL = Number(process.env.ROOM_INACTIVE_TTL_SECS ?? 6);

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

async function fetchJSON(url, options = {}) {
  const res = await fetch(url, options);
  const body = await res.json();
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}: ${JSON.stringify(body)}`);
  return body;
}
const post  = (url, data, hdrs = {}) =>
  fetchJSON(url, { method: "POST",  headers: { "Content-Type": "application/json", ...hdrs }, body: JSON.stringify(data) });
const patch = (url, data, hdrs = {}) =>
  fetchJSON(url, { method: "PATCH", headers: { "Content-Type": "application/json", ...hdrs }, body: JSON.stringify(data) });

/** Query room status via the debug endpoint (no auth required). */
async function roomStatus(roomId, base = S1) {
  try {
    const body = await fetchJSON(`${base}/debug/room-status?roomId=${roomId}`);
    return body.status ?? null;
  } catch { return null; }
}

/** Poll until room reaches targetStatus or timeout. */
async function pollStatus(roomId, target, timeoutMs, base = S1) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await roomStatus(roomId, base) === target) return true;
    await sleep(300);
  }
  return false;
}

async function waitForServer(url, label, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if ((await fetch(url)).ok) { console.log(`  ✓ ${label} is up`); return; } } catch {}
    await sleep(300);
  }
  throw new Error(`${label} did not start within ${timeoutMs} ms`);
}

async function waitForDown(url, label, timeoutMs = 12_000) {
  const deadline = Date.now() + timeoutMs;
  // Wait briefly first — process needs time to start shutting down
  await sleep(500);
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(500) });
      if (!res.ok) { console.log(`  ✓ ${label} is down`); return; }
    } catch {
      console.log(`  ✓ ${label} is down`);
      return;
    }
    await sleep(300);
  }
  // Accept that the port may still be in TIME_WAIT but the process is dead
  console.log(`  ⚠ ${label} slow to confirm down — continuing`);
}

function openWS(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.on("open",  () => resolve(ws));
    ws.on("error", reject);
  });
}

// ---------------------------------------------------------------------------
// Result tracking
// ---------------------------------------------------------------------------

const results = [];
function check(label, passed) {
  console.log(`  ${passed ? "✅" : "❌"}  ${label}`);
  results.push({ label, passed });
}

// ---------------------------------------------------------------------------
// Process management
// ---------------------------------------------------------------------------

const procs = {};
function startServer(port) {
  const proc = spawn("npx", ["tsx", "src/index.ts"], {
    cwd: new URL("..", import.meta.url).pathname,
    env: {
      ...process.env,
      PORT: String(port),
      SERVER_ID: `server-${port}`,
      ROOM_INACTIVE_TTL_SECS: String(TTL),
      WS_RECONNECT_GRACE_MS: "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  proc.stderr.on("data", (d) => {
    const line = d.toString();
    if (!line.includes("tsx") && !line.includes("warn") && !line.includes("DeprecationWarning")) {
      process.stderr.write(`[S${port}] ${line}`);
    }
  });
  procs[port] = proc;
  return proc;
}
function killServer(port) {
  if (procs[port]) {
    procs[port].kill("SIGTERM");
    delete procs[port];
  }
}
function killAll() { for (const p of Object.values(procs)) p.kill(); }
process.on("exit", killAll);
process.on("SIGINT", () => { killAll(); process.exit(1); });

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`  Phase 7.4 — Room TTL / Expiry demo  (TTL=${TTL}s)`);
console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

startServer(3000);
await waitForServer(`${S1}/health`, "Server 1 :3000");

// ── Scenario 1: INACTIVE → TTL → CLOSED ─────────────────────────────────────
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("  Scenario 1 — Last member leaves → INACTIVE → TTL → CLOSED");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

const { room: r1, participant: p1 } = await post(`${S1}/rooms`, { displayName: "Ayush" });
console.log(`\n▶ Room ${r1.code} created (id: ${r1.id})`);

// Connect Ayush so we can observe ROOM_CLOSED via WS
const ws1 = await openWS(`ws://localhost:3000/ws?participantId=${p1.id}&roomId=${r1.id}`);
const wsMsgs1 = [];
ws1.on("message", (raw) => wsMsgs1.push(JSON.parse(raw.toString())));
await sleep(300);

console.log(`▶ Ayush leaves → room should become INACTIVE…`);
await patch(`${S1}/rooms/${r1.id}/participants/${p1.id}/leave`, {}, { "x-participant-id": p1.id });
await sleep(300);

check("Room INACTIVE immediately after last member leaves", await roomStatus(r1.id) === "INACTIVE");

console.log(`▶ Waiting ${TTL + 3}s for TTL to expire…`);
await sleep((TTL + 3) * 1000);

check(`Room CLOSED after ${TTL}s TTL expiry`, await roomStatus(r1.id) === "CLOSED");
check("WS client received ROOM_CLOSED broadcast", wsMsgs1.some((m) => m.type === "ROOM_CLOSED"));
ws1.close();

// ── Scenario 2: Disconnect ≠ leave — no TTL armed ────────────────────────────
console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("  Scenario 2 — WS disconnect (not leave) does NOT arm TTL");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

const { room: r2, participant: p2 } = await post(`${S1}/rooms`, { displayName: "Ayush" });
console.log(`\n▶ Room ${r2.code} created`);

const ws2 = await openWS(`ws://localhost:3000/ws?participantId=${p2.id}&roomId=${r2.id}`);
await sleep(300);

console.log(`▶ Closing WebSocket (disconnect only, NOT leave)…`);
ws2.close();
await sleep(TTL * 1000 + 2000); // wait a full TTL — room must still be ACTIVE

const statusAfterDisconnect = await roomStatus(r2.id);
check("Room stays ACTIVE after WS disconnect (no leave)", statusAfterDisconnect === "ACTIVE");
check("Room NOT CLOSED after full TTL (no expiry key armed)", statusAfterDisconnect !== "CLOSED");

// ── Scenario 3: Restart recovery ─────────────────────────────────────────────
console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("  Scenario 3 — Restart recovery re-arms INACTIVE rooms");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

const { room: r3, participant: p3 } = await post(`${S1}/rooms`, { displayName: "Ayush" });
console.log(`\n▶ Room ${r3.code} created`);

// Make room INACTIVE via leave
await patch(`${S1}/rooms/${r3.id}/participants/${p3.id}/leave`, {}, { "x-participant-id": p3.id });
check("Room 3 INACTIVE", await roomStatus(r3.id) === "INACTIVE");

// Kill server — simulating crash
console.log(`▶ Killing server (simulating process crash)…`);
killServer(3000);
await waitForDown(`${S1}/health`, "Server 1 :3000");

// Delete the Redis expiry key to simulate "server crashed before setRoomExpiry completed"
try {
  execSync(`redis-cli DEL room:expiry:${r3.id}`, { stdio: "pipe" });
  console.log(`▶ Deleted Redis expiry key (simulating crash-before-arm)…`);
} catch {
  console.log(`▶ (redis-cli not available — testing re-arm idempotency instead)`);
}

// Restart — rearmInactiveRooms() runs at startup
console.log(`▶ Restarting server…`);
startServer(3000);
await waitForServer(`${S1}/health`, "Server 1 :3000 (restarted)");
await sleep(800); // let rearmInactiveRooms() run

// Confirm still INACTIVE immediately after restart
check("Room still INACTIVE right after restart", await roomStatus(r3.id) === "INACTIVE");

// Wait for re-armed TTL to fire
console.log(`▶ Waiting ${TTL + 3}s for re-armed TTL to expire…`);
await sleep((TTL + 3) * 1000);

check("Room CLOSED after restart + re-arm + TTL expiry", await roomStatus(r3.id) === "CLOSED");

// ── Summary ───────────────────────────────────────────────────────────────────
const passed = results.filter((r) => r.passed).length;
const total  = results.length;

console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log(`  Results: ${passed}/${total} passed`);
if (passed === total) {
  console.log("  🎉  Room TTL/expiry working correctly.");
  console.log("      INACTIVE → Redis TTL → PostgreSQL CLOSED.");
  console.log("      Disconnect ≠ leave. Recovery re-arms on restart.");
} else {
  for (const r of results.filter((r) => !r.passed)) {
    console.log(`  ❌  ${r.label}`);
  }
}
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

killAll();
process.exit(passed === total ? 0 : 1);
