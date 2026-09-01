/**
 * Phase 7.3 — Distributed presence demo
 *
 * Scenarios tested:
 *   1. Connect    — Ayush (S1) and Alex (S2) both appear in /presence from either server
 *   2. Disconnect — Alex closes cleanly; presence removed immediately from Redis
 *   3. TTL expiry — Alex reconnects, then the S2 process is killed;
 *                   after PRESENCE_TTL_SECS the key expires and Alex disappears
 *   4. Reconnect  — Alex reconnects to S1; presence restores on S1
 *
 * Run with a short TTL so the expiry test completes quickly:
 *   PRESENCE_TTL_SECS=5 node scripts/demo-phase7-3.mjs
 */

import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import WebSocket from "ws";

const S1 = "http://localhost:3000";
const S2 = "http://localhost:3001";
const TTL = Number(process.env.PRESENCE_TTL_SECS ?? 5);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function fetchJSON(url, options = {}) {
  const res = await fetch(url, options);
  const body = await res.json();
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}: ${JSON.stringify(body)}`);
  return body;
}
const post  = (url, data, headers = {}) =>
  fetchJSON(url, { method: "POST",  headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(data) });
const patch = (url, data, headers = {}) =>
  fetchJSON(url, { method: "PATCH", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(data) });

async function waitForServer(url, label, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if ((await fetch(url)).ok) { console.log(`  ✓ ${label} is up`); return; } } catch {}
    await sleep(300);
  }
  throw new Error(`${label} did not start within ${timeoutMs} ms`);
}

async function waitForServerDown(url, label, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { await fetch(url); } catch { console.log(`  ✓ ${label} is down`); return; }
    await sleep(200);
  }
  throw new Error(`${label} did not stop within ${timeoutMs} ms`);
}

function openWS(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.on("open",  ()  => resolve(ws));
    ws.on("error", reject);
  });
}

async function presence(base, roomId) {
  return fetchJSON(`${base}/rooms/${roomId}/presence`);
}

// ---------------------------------------------------------------------------
// Result tracking
// ---------------------------------------------------------------------------

const results = [];
function check(label, passed) {
  const icon = passed ? "✅" : "❌";
  console.log(`  ${icon}  ${label}`);
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
      PRESENCE_TTL_SECS: String(TTL),
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
  procs[port]?.kill();
  delete procs[port];
}

function killAll() { for (const p of Object.values(procs)) p.kill(); }
process.on("exit", killAll);
process.on("SIGINT", () => { killAll(); process.exit(1); });

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`  Phase 7.3 — Distributed Presence demo  (TTL=${TTL}s)`);
console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

// ── Start both servers ────────────────────────────────────────────────────────
console.log("▶ Starting Server 1 (:3000) and Server 2 (:3001)…");
startServer(3000);
startServer(3001);
await waitForServer(`${S1}/health`, "Server 1 :3000");
await waitForServer(`${S2}/health`, "Server 2 :3001");

// ── Create room + participants ────────────────────────────────────────────────
console.log("\n▶ Creating room (Ayush = HOST)…");
const { room, participant: ayush } = await post(`${S1}/rooms`, { displayName: "Ayush" });
console.log(`  Room: ${room.code}  (id: ${room.id})`);

const { joinRequest: alexReq } = await post(`${S1}/rooms/${room.code}/join-requests`, { displayName: "Alex" });
const { participant: alex }    = await patch(`${S1}/rooms/${room.id}/join-requests/${alexReq.id}`, { action: "ACCEPT" }, { "x-participant-id": ayush.id });

// ── Scenario 1: Connect ───────────────────────────────────────────────────────
console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("  Scenario 1 — Connect");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("▶ Ayush connects to Server 1, Alex connects to Server 2…");

const ayushWS = await openWS(`ws://localhost:3000/ws?participantId=${ayush.id}&roomId=${room.id}`);
const alexWS  = await openWS(`ws://localhost:3001/ws?participantId=${alex.id}&roomId=${room.id}`);
await sleep(500); // let registration propagate

const p1_s1 = await presence(S1, room.id);
const p1_s2 = await presence(S2, room.id);

console.log(`\n  From Server 1: ${p1_s1.onlineCount} online`);
for (const p of p1_s1.participants) console.log(`    • ${p.participantId.slice(-6)}  on ${p.serverId}`);

console.log(`  From Server 2: ${p1_s2.onlineCount} online`);
for (const p of p1_s2.participants) console.log(`    • ${p.participantId.slice(-6)}  on ${p.serverId}`);

const ayushInS1 = p1_s1.participants.some((p) => p.participantId === ayush.id && p.serverId === "server-3000");
const alexInS1  = p1_s1.participants.some((p) => p.participantId === alex.id  && p.serverId === "server-3001");
const ayushInS2 = p1_s2.participants.some((p) => p.participantId === ayush.id);
const alexInS2  = p1_s2.participants.some((p) => p.participantId === alex.id);

check("Ayush appears in S1 /presence  (server-3000)", ayushInS1);
check("Alex  appears in S1 /presence  (server-3001)", alexInS1);
check("Both  appear  in S2 /presence", p1_s2.onlineCount === 2 && ayushInS2 && alexInS2);

// ── Scenario 2: Clean disconnect ─────────────────────────────────────────────
console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("  Scenario 2 — Clean disconnect");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("▶ Alex closes his WebSocket cleanly…");

alexWS.close();
await sleep(600); // let removePresence() complete

const p2 = await presence(S1, room.id);
console.log(`\n  From Server 1 after Alex disconnects: ${p2.onlineCount} online`);
for (const p of p2.participants) console.log(`    • ${p.participantId.slice(-6)}  on ${p.serverId}`);

check("After clean disconnect, only Ayush remains", p2.onlineCount === 1 && p2.participants[0]?.participantId === ayush.id);
check("Alex is gone from presence immediately",     !p2.participants.some((p) => p.participantId === alex.id));

// ── Scenario 3: TTL expiry (process crash simulation) ────────────────────────
console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log(`  Scenario 3 — TTL expiry after process crash  (TTL=${TTL}s)`);
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

// Re-connect Alex to Server 2
const alexWS2 = await openWS(`ws://localhost:3001/ws?participantId=${alex.id}&roomId=${room.id}`);
await sleep(500);

const p3_before = await presence(S1, room.id);
check("Alex back online before crash", p3_before.participants.some((p) => p.participantId === alex.id));

console.log(`\n▶ Killing Server 2 (simulating process crash)…`);
killServer(3001);
await waitForServerDown(`${S2}/health`, "Server 2 :3001");
void alexWS2; // already dead — just let GC handle it

console.log(`▶ Waiting ${TTL + 2}s for presence TTL to expire…`);
await sleep((TTL + 2) * 1000);

const p3_after = await presence(S1, room.id);
console.log(`\n  From Server 1 after TTL expiry: ${p3_after.onlineCount} online`);
for (const p of p3_after.participants) console.log(`    • ${p.participantId.slice(-6)}  on ${p.serverId}`);

check(`Alex gone after TTL=${TTL}s expiry (no heartbeat from dead process)`,
  !p3_after.participants.some((p) => p.participantId === alex.id));
check("Ayush still present (heartbeat kept his key alive)", p3_after.participants.some((p) => p.participantId === ayush.id));

// ── Scenario 4: Reconnect ─────────────────────────────────────────────────────
console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("  Scenario 4 — Reconnect to surviving instance (Server 1)");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("▶ Alex reconnects — this time to Server 1…");

const alexWS3 = await openWS(`ws://localhost:3000/ws?participantId=${alex.id}&roomId=${room.id}`);
await sleep(500);

const p4 = await presence(S1, room.id);
console.log(`\n  From Server 1 after Alex reconnects: ${p4.onlineCount} online`);
for (const p of p4.participants) console.log(`    • ${p.participantId.slice(-6)}  on ${p.serverId}`);

check("Alex back in presence after reconnect",   p4.participants.some((p) => p.participantId === alex.id  && p.serverId === "server-3000"));
check("Ayush still present after Alex reconnect", p4.participants.some((p) => p.participantId === ayush.id));
check("Total: 2 online", p4.onlineCount === 2);

// ── Cleanup ──────────────────────────────────────────────────────────────────
ayushWS.close();
alexWS3.close();

// ── Summary ───────────────────────────────────────────────────────────────────
const passed = results.filter((r) => r.passed).length;
const total  = results.length;

console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log(`  Results: ${passed}/${total} passed`);
if (passed === total) {
  console.log("  🎉  Distributed presence working across instances.");
  console.log("      PostgreSQL = membership  |  Redis TTL = online state");
} else {
  for (const r of results.filter((r) => !r.passed)) {
    console.log(`  ❌  ${r.label}`);
  }
}
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

killAll();
process.exit(passed === total ? 0 : 1);
