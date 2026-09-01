/**
 * Phase 7.1 — Cross-instance WebSocket broadcast failure demo
 *
 * What this script does:
 *   1. Spawns two backend instances (ports 3000 and 3001) as child processes
 *   2. Creates a room via Server 1 (Ayush = HOST)
 *   3. Alex submits a join request; Ayush accepts it
 *   4. Connects Ayush's WebSocket to Server 1
 *   5. Connects Alex's WebSocket to Server 2
 *   6. Queries /debug/connections on both instances to show each sees only one person
 *   7. Ayush sends PLAY from Server 1
 *   8. Waits 1 second, then reports what each client received
 *
 * Expected result:
 *   ✅ Ayush (Server 1) receives the PLAY broadcast
 *   ❌ Alex  (Server 2) receives NOTHING — the cross-instance failure
 */

import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import WebSocket from "ws";

const S1 = "http://localhost:3000";
const S2 = "http://localhost:3001";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function fetchJSON(url, options = {}) {
  const res = await fetch(url, options);
  const body = await res.json();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${url}: ${JSON.stringify(body)}`);
  }
  return body;
}

function post(url, data) {
  return fetchJSON(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

function patch(url, data, headers = {}) {
  return fetchJSON(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(data),
  });
}

/** Wait until GET <url> returns 200 (server is up), retrying every 300 ms. */
async function waitForServer(url, label, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        console.log(`  ✓ ${label} is up`);
        return;
      }
    } catch {
      // not ready yet
    }
    await sleep(300);
  }
  throw new Error(`${label} did not start within ${timeoutMs} ms`);
}

/** Open a WebSocket and collect every message into an array. */
function openWS(url) {
  return new Promise((resolve, reject) => {
    const messages = [];
    const ws = new WebSocket(url);
    ws.on("open", () => resolve({ ws, messages }));
    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      messages.push(msg);
    });
    ws.on("error", reject);
  });
}

/** Send a client event envelope. */
function sendEvent(ws, type, payload = {}) {
  ws.send(JSON.stringify({ type, payload }));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const procs = [];

function startServer(port) {
  const proc = spawn(
    "npx",
    ["tsx", "src/index.ts"],
    {
      cwd: new URL("..", import.meta.url).pathname,
      env: { ...process.env, PORT: String(port) },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  proc.stdout.on("data", (d) => {
    // uncomment to debug server output:
    // process.stdout.write(`[S${port}] ${d}`);
  });
  proc.stderr.on("data", (d) => {
    // suppress normal tsx compile output — only print real errors
    const line = d.toString();
    if (!line.includes("Restarting") && !line.includes("tsx") && !line.includes("warn")) {
      process.stderr.write(`[S${port}] ${line}`);
    }
  });
  procs.push(proc);
  return proc;
}

function killAll() {
  for (const p of procs) p.kill();
}

process.on("exit", killAll);
process.on("SIGINT", () => { killAll(); process.exit(1); });

// ---------------------------------------------------------------------------

console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("  Phase 7.1 — Cross-instance broadcast failure demo");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

// ── Step 1: Start both servers ──────────────────────────────────────────────
console.log("▶ Starting Server 1 (port 3000) and Server 2 (port 3001)…");
startServer(3000);
startServer(3001);

await waitForServer(`${S1}/health`, "Server 1 :3000");
await waitForServer(`${S2}/health`, "Server 2 :3001");

// ── Step 2: Create room (Ayush = HOST) ──────────────────────────────────────
console.log("\n▶ Creating room — Ayush as HOST via Server 1…");
const { room, participant: ayush } = await post(`${S1}/rooms`, { displayName: "Ayush" });
console.log(`  Room id:   ${room.id}`);
console.log(`  Room code: ${room.code}`);
console.log(`  Ayush id:  ${ayush.id}  (role: ${ayush.role})`);

// ── Step 3: Alex submits join request, Ayush accepts ────────────────────────
console.log("\n▶ Alex submits join request…");
const { joinRequest } = await post(`${S1}/rooms/${room.code}/join-requests`, { displayName: "Alex" });
console.log(`  Join request id: ${joinRequest.id}`);

console.log("▶ Ayush accepts Alex's join request…");
const acceptResult = await patch(
  `${S1}/rooms/${room.id}/join-requests/${joinRequest.id}`,
  { action: "ACCEPT" },
  { "x-participant-id": ayush.id },
);
const alex = acceptResult.participant;
console.log(`  Alex id: ${alex.id}  (role: ${alex.role})`);

// ── Step 4: Connect WebSockets ───────────────────────────────────────────────
console.log("\n▶ Connecting Ayush → Server 1 :3000 …");
const { ws: ayushWS, messages: ayushMessages } = await openWS(
  `ws://localhost:3000/ws?participantId=${ayush.id}&roomId=${room.id}`,
);
console.log("  ✓ Ayush connected to Server 1");

console.log("▶ Connecting Alex  → Server 2 :3001 …");
const { ws: alexWS, messages: alexMessages } = await openWS(
  `ws://localhost:3001/ws?participantId=${alex.id}&roomId=${room.id}`,
);
console.log("  ✓ Alex  connected to Server 2");

// Give ROOM_STATE messages a moment to arrive
await sleep(300);

// ── Step 5: Show what each instance knows ───────────────────────────────────
console.log("\n▶ Querying /debug/connections on each instance…");

const s1View = await fetchJSON(`${S1}/debug/connections?roomId=${room.id}`);
const s2View = await fetchJSON(`${S2}/debug/connections?roomId=${room.id}`);

console.log(`\n  Server 1 :3000 sees ${s1View.connectionCount} connection(s):`);
for (const c of s1View.connections) {
  console.log(`    • ${c.displayName} (${c.role})`);
}
console.log(`\n  Server 2 :3001 sees ${s2View.connectionCount} connection(s):`);
for (const c of s2View.connections) {
  console.log(`    • ${c.displayName} (${c.role})`);
}

// ── Step 6: First, add a song so PLAY has a currentSongId ───────────────────
// Grab the first available song from the library
const songsRes = await fetchJSON(`${S1}/songs`);
const firstSong = songsRes.songs?.[0];
if (!firstSong) throw new Error("No songs in DB — run npm run seed first");

console.log(`\n▶ Adding "${firstSong.title}" to playlist (so PLAY has a song to play)…`);
const addResult = await fetchJSON(`${S1}/rooms/${room.id}/playlist`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "x-participant-id": ayush.id },
  body: JSON.stringify({ songId: firstSong.id }),
});
console.log(`  Entry id: ${addResult.entry?.id ?? JSON.stringify(addResult)}`);
await sleep(300);

// Clear accumulated messages so we start fresh before PLAY
ayushMessages.length = 0;
alexMessages.length  = 0;

// ── Step 7: Ayush sends PLAY ─────────────────────────────────────────────────
console.log("\n▶ Ayush sends PLAY { positionSecs: 0 } via Server 1…");
sendEvent(ayushWS, "PLAY", { positionSecs: 0 });

// Wait for broadcast to propagate (or not)
await sleep(1000);

// ── Step 8: Report results ───────────────────────────────────────────────────
const ayushPlay = ayushMessages.filter((m) => m.type === "PLAY");
const alexPlay  = alexMessages.filter((m) => m.type === "PLAY");

console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("  Results after PLAY");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

if (ayushPlay.length > 0) {
  console.log(`\n  ✅  Ayush (Server 1) received PLAY`);
  console.log(`      payload: ${JSON.stringify(ayushPlay[0].payload)}`);
} else {
  console.log(`\n  ❌  Ayush (Server 1) did NOT receive PLAY  ← unexpected`);
}

if (alexPlay.length === 0) {
  console.log(`\n  ❌  Alex  (Server 2) received NOTHING`);
  console.log("      broadcastToRoom() only iterated Server 1's in-memory map.");
  console.log("      Alex's socket lives in Server 2's map — unreachable.");
} else {
  console.log(`\n  ✅  Alex  (Server 2) received PLAY  ← unexpected, something changed`);
  console.log(`      payload: ${JSON.stringify(alexPlay[0].payload)}`);
}

console.log("\n  All messages Alex received during this demo:");
if (alexMessages.length === 0) {
  console.log("    (none except the initial ROOM_STATE — cleared before PLAY)");
} else {
  for (const m of alexMessages) {
    console.log(`    • [${m.type}] ${JSON.stringify(m.payload).slice(0, 80)}`);
  }
}

console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("  This is the problem Redis Pub/Sub will fix in 7.2");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

ayushWS.close();
alexWS.close();
killAll();
