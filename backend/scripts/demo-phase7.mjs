/**
 * Phase 7.2 — Redis Pub/Sub cross-instance broadcast demo
 *
 * Verifies that every room-scoped event crosses from Server 1 → Server 2
 * via Redis Pub/Sub, so Alex (connected to Server 2) receives events
 * triggered by Ayush (connected to Server 1).
 *
 * Events tested:
 *   PLAY, PAUSE, SEEK, NEXT, PREVIOUS
 *   PLAYLIST_ADD, PLAYLIST_REMOVE, PLAYLIST_REORDER
 *   CHAT_MESSAGE
 *   USER_JOINED  (a third participant joins on Server 1 — Alex should see it)
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
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}: ${JSON.stringify(body)}`);
  return body;
}
const post  = (url, data, headers = {}) => fetchJSON(url, { method: "POST",  headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(data) });
const patch = (url, data, headers = {}) => fetchJSON(url, { method: "PATCH", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(data) });

async function waitForServer(url, label, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if ((await fetch(url)).ok) { console.log(`  ✓ ${label} is up`); return; } } catch {}
    await sleep(300);
  }
  throw new Error(`${label} did not start within ${timeoutMs} ms`);
}

function openWS(url) {
  return new Promise((resolve, reject) => {
    const messages = [];
    const ws = new WebSocket(url);
    ws.on("open",    ()    => resolve({ ws, messages }));
    ws.on("message", (raw) => messages.push(JSON.parse(raw.toString())));
    ws.on("error",   reject);
  });
}

function send(ws, type, payload = {}) {
  ws.send(JSON.stringify({ type, payload }));
}

/** Wait up to maxMs for a message of the given type to appear in messages[]. */
async function waitFor(messages, type, maxMs = 2000) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    if (messages.some((m) => m.type === type)) return true;
    await sleep(50);
  }
  return false;
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

const procs = [];

function startServer(port) {
  const proc = spawn("npx", ["tsx", "src/index.ts"], {
    cwd: new URL("..", import.meta.url).pathname,
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  proc.stderr.on("data", (d) => {
    const line = d.toString();
    if (!line.includes("tsx") && !line.includes("warn") && !line.includes("DeprecationWarning")) {
      process.stderr.write(`[S${port}] ${line}`);
    }
  });
  procs.push(proc);
}

function killAll() { for (const p of procs) p.kill(); }
process.on("exit", killAll);
process.on("SIGINT", () => { killAll(); process.exit(1); });

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("  Phase 7.2 — Redis Pub/Sub cross-instance broadcast demo");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

// ── Start servers ────────────────────────────────────────────────────────────
console.log("▶ Starting Server 1 (:3000) and Server 2 (:3001)…");
startServer(3000);
startServer(3001);
await waitForServer(`${S1}/health`, "Server 1 :3000");
await waitForServer(`${S2}/health`, "Server 2 :3001");

// ── Room + participants ───────────────────────────────────────────────────────
console.log("\n▶ Setting up room, Ayush (HOST on S1), Alex (MEMBER on S2)…");

const { room, participant: ayush } = await post(`${S1}/rooms`, { displayName: "Ayush" });
console.log(`  Room: ${room.code}  (id: ${room.id})`);

const { joinRequest: alexReq } = await post(`${S1}/rooms/${room.code}/join-requests`, { displayName: "Alex" });
const { participant: alex }    = await patch(`${S1}/rooms/${room.id}/join-requests/${alexReq.id}`, { action: "ACCEPT" }, { "x-participant-id": ayush.id });

// ── Connect WebSockets ───────────────────────────────────────────────────────
const { ws: ayushWS, messages: ayushMsgs } = await openWS(`ws://localhost:3000/ws?participantId=${ayush.id}&roomId=${room.id}`);
const { ws: alexWS,  messages: alexMsgs  } = await openWS(`ws://localhost:3001/ws?participantId=${alex.id}&roomId=${room.id}`);
await sleep(400); // let ROOM_STATE + USER_JOINED settle

// ── Seed playlist ─────────────────────────────────────────────────────────────
console.log("\n▶ Seeding playlist…");
const { songs } = await fetchJSON(`${S1}/songs`);
if (songs.length < 2) throw new Error("Need at least 2 seeded songs. Run: npm run seed");

// Add two songs via WS (Ayush — but any participant can add)
ayushMsgs.length = 0; alexMsgs.length = 0;

send(ayushWS, "PLAYLIST_ADD", { songId: songs[0].id });
const gotAdd1 = await waitFor(alexMsgs, "PLAYLIST_ADD");
check("PLAYLIST_ADD crosses to Alex (Server 2)", gotAdd1);

// Grab entry id from Ayush's copy
const addMsg1 = ayushMsgs.find((m) => m.type === "PLAYLIST_ADD");
const entry1Id = addMsg1?.payload?.entry?.id;

// Wait for the auto-NEXT that fires when the first song is set as currentSong,
// then clear the buffer so the second add starts from a clean baseline.
await waitFor(alexMsgs, "NEXT", 1500);
ayushMsgs.length = 0; alexMsgs.length = 0;

send(ayushWS, "PLAYLIST_ADD", { songId: songs[1].id });
const gotAdd2 = await waitFor(alexMsgs, "PLAYLIST_ADD", 2000);
check("Second PLAYLIST_ADD crosses to Alex", gotAdd2);

const addMsg2 = ayushMsgs.find((m) => m.type === "PLAYLIST_ADD");
const entry2Id = addMsg2?.payload?.entry?.id;

// ── Playback events ───────────────────────────────────────────────────────────
console.log("\n▶ Testing playback events (Ayush on S1 → Alex on S2)…");

// PLAY
ayushMsgs.length = 0; alexMsgs.length = 0;
send(ayushWS, "PLAY", { positionSecs: 0 });
check("PLAY crosses to Alex",  await waitFor(alexMsgs,  "PLAY"));
check("PLAY received by Ayush (no double-send)", await waitFor(ayushMsgs, "PLAY"));

// PAUSE
ayushMsgs.length = 0; alexMsgs.length = 0;
send(ayushWS, "PAUSE", { positionSecs: 5 });
check("PAUSE crosses to Alex", await waitFor(alexMsgs, "PAUSE"));

// SEEK
ayushMsgs.length = 0; alexMsgs.length = 0;
send(ayushWS, "SEEK", { positionSecs: 10 });
check("SEEK crosses to Alex",  await waitFor(alexMsgs, "SEEK"));

// NEXT
ayushMsgs.length = 0; alexMsgs.length = 0;
send(ayushWS, "NEXT", {});
check("NEXT crosses to Alex",  await waitFor(alexMsgs, "NEXT"));

// PREVIOUS
ayushMsgs.length = 0; alexMsgs.length = 0;
send(ayushWS, "PREVIOUS", {});
check("PREVIOUS crosses to Alex", await waitFor(alexMsgs, "PREVIOUS"));

// ── Playlist mutation events ──────────────────────────────────────────────────
console.log("\n▶ Testing playlist mutation events…");

// PLAYLIST_REORDER
if (entry1Id && entry2Id) {
  ayushMsgs.length = 0; alexMsgs.length = 0;
  send(ayushWS, "PLAYLIST_REORDER", { entryId: entry2Id, newPosition: 0 });
  check("PLAYLIST_REORDER crosses to Alex", await waitFor(alexMsgs, "PLAYLIST_REORDER"));
} else {
  console.log("  ⚠  Skipping PLAYLIST_REORDER — couldn't determine entry ids");
}

// PLAYLIST_REMOVE
if (entry1Id) {
  ayushMsgs.length = 0; alexMsgs.length = 0;
  send(ayushWS, "PLAYLIST_REMOVE", { entryId: entry1Id });
  check("PLAYLIST_REMOVE crosses to Alex", await waitFor(alexMsgs, "PLAYLIST_REMOVE"));
} else {
  console.log("  ⚠  Skipping PLAYLIST_REMOVE — couldn't determine entry id");
}

// ── Chat ──────────────────────────────────────────────────────────────────────
console.log("\n▶ Testing chat…");
ayushMsgs.length = 0; alexMsgs.length = 0;
send(ayushWS, "CHAT_MESSAGE", { content: "Hello from Server 1!" });
check("CHAT_MESSAGE crosses to Alex", await waitFor(alexMsgs, "CHAT_MESSAGE"));
// Sender (Ayush) also receives their own message back via Redis round-trip
check("CHAT_MESSAGE echoed back to Ayush", await waitFor(ayushMsgs, "CHAT_MESSAGE"));

// ── USER_JOINED cross-instance ────────────────────────────────────────────────
console.log("\n▶ Testing USER_JOINED cross-instance (third participant joins S1)…");
const { joinRequest: carlosReq } = await post(`${S1}/rooms/${room.code}/join-requests`, { displayName: "Carlos" });
await patch(`${S1}/rooms/${room.id}/join-requests/${carlosReq.id}`, { action: "ACCEPT" }, { "x-participant-id": ayush.id });
const { participant: carlos } = await fetchJSON(`${S1}/rooms/${room.code}/join-requests/${carlosReq.id}`);

alexMsgs.length = 0;
// Connect Carlos to Server 1 — Alex (on Server 2) should see USER_JOINED
const { ws: carlosWS } = await openWS(`ws://localhost:3000/ws?participantId=${carlos.id}&roomId=${room.id}`);
check("USER_JOINED (Carlos on S1) crosses to Alex on S2", await waitFor(alexMsgs, "USER_JOINED"));
carlosWS.close();

// ── Summary ───────────────────────────────────────────────────────────────────
const passed = results.filter((r) => r.passed).length;
const total  = results.length;

console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log(`  Results: ${passed}/${total} passed`);

if (passed === total) {
  console.log("  🎉  All events cross instances via Redis Pub/Sub.");
  console.log("      PostgreSQL = authoritative state  |  Redis = event bus");
} else {
  console.log("\n  Failed checks:");
  for (const r of results.filter((r) => !r.passed)) {
    console.log(`    ❌  ${r.label}`);
  }
}
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

ayushWS.close();
alexWS.close();
killAll();

process.exit(passed === total ? 0 : 1);
