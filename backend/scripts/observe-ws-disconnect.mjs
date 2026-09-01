/**
 * Phase 8.3 — Observe raw WebSocket behavior when a backend instance dies
 *
 * What this script does:
 *   1. Creates a room + two participants (HOST + MEMBER)
 *   2. Connects both WebSockets through the LB (:8080)
 *      - Forces HOST onto S1 directly, MEMBER through LB
 *   3. Logs every WS event (open, message, error, close) with timestamps
 *   4. Waits for the human operator to kill S1 (the instance hosting HOST)
 *   5. Records exactly what the WS client observes:
 *        - How long until close fires?
 *        - What close code?
 *        - Does it fire at all without a keepalive?
 *   6. Attempts NO automatic reconnect — pure observation
 *
 * Run this, then in another terminal: kill the S1 process.
 * Read the output to understand what the client actually sees.
 */

import WebSocket from "ws";

const LB    = "http://localhost:8080";
const S1_WS = "ws://localhost:3000/ws";
const WS_LB = "ws://localhost:8080/ws";

function ts() {
  return new Date().toISOString().slice(11, 23);
}

function log(who, ...args) {
  console.log(`[${ts()}] [${who}]`, ...args);
}

async function api(method, path, body, headers = {}) {
  const res = await fetch(`${LB}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${await res.text()}`);
  return res.json();
}

function observe(wsUrl, participantId, roomId, label) {
  return new Promise((resolveConnected) => {
    const url = `${wsUrl}?participantId=${participantId}&roomId=${roomId}`;
    const ws = new WebSocket(url);
    let connected = false;
    const openedAt = Date.now();

    ws.on("open", () => {
      log(label, `OPEN  →  ${wsUrl}`);
    });

    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      if (!connected) {
        connected = true;
        log(label, `ROOM_STATE received — socket is live`);
        resolveConnected(ws);
      } else {
        log(label, `MESSAGE  type=${msg.type}`);
      }
    });

    ws.on("ping", () => {
      log(label, `PING received from server`);
    });

    ws.on("error", (err) => {
      log(label, `ERROR  ${err.message}`);
    });

    ws.on("close", (code, reason) => {
      const elapsed = ((Date.now() - openedAt) / 1000).toFixed(1);
      log(label, `CLOSE  code=${code}  reason="${reason}"  elapsed=${elapsed}s`);
      log(label, `↑ This is what the client sees when the backend dies.`);
    });
  });
}

(async () => {
  // ── Setup ─────────────────────────────────────────────────────────────────
  log("setup", "creating room...");
  const { room, participant: host } = await api("POST", "/rooms", { displayName: "Alice (HOST)" });
  const { joinRequest } = await api("POST", `/rooms/${room.code}/join-requests`, { displayName: "Bob (MEMBER)" });
  const { participant: bob } = await api(
    "PATCH",
    `/rooms/${room.id}/join-requests/${joinRequest.id}`,
    { action: "ACCEPT" },
    { "X-Participant-Id": host.id }
  );
  log("setup", `room=${room.id}  host=${host.id}  bob=${bob.id}`);

  // ── Connect ───────────────────────────────────────────────────────────────
  // HOST pinned to S1 directly so we know exactly which instance to kill
  log("alice", "connecting HOST directly to S1 (:3000)...");
  const aliceWs = await observe(S1_WS, host.id, room.id, "alice");

  log("bob", "connecting MEMBER via LB (:8080)...");
  const bobWs = await observe(WS_LB, bob.id, room.id, "bob");

  console.log("");
  console.log("══════════════════════════════════════════════════════");
  console.log("  Both clients connected and receiving messages.");
  console.log("");
  console.log("  ➜  NOW KILL S1:  kill the 'npm run dev:1' process");
  console.log("     (or: pkill -f 'PORT=3000')");
  console.log("");
  console.log("  Watch this output for CLOSE events.");
  console.log("  The script will exit 30s after S1 dies.");
  console.log("══════════════════════════════════════════════════════");
  console.log("");

  // ── Wait for close events then report ─────────────────────────────────────
  // We'll hang until both sockets close or timeout
  const results = await Promise.race([
    // Wait for the HOST socket to close (it will close when S1 dies)
    new Promise((resolve) => {
      aliceWs.once("close", (code, reason) => {
        resolve({ who: "alice", code, reason: reason.toString(), elapsed: Date.now() });
      });
    }),
    // Timeout safety net: if nothing happens in 60s, exit anyway
    new Promise((resolve) => setTimeout(() => resolve({ who: "timeout" }), 60_000)),
  ]);

  if (results.who !== "timeout") {
    // Give bob's socket a moment to also close (or not — that's informative too)
    await new Promise(r => setTimeout(r, 3_000));

    console.log("");
    log("observe", "=== Summary ===");
    log("observe", `alice socket closed: code=${results.code}  reason="${results.reason}"`);
    log("observe", `bob socket readyState: ${["CONNECTING","OPEN","CLOSING","CLOSED"][bobWs.readyState] ?? bobWs.readyState}`);
    log("observe", "Bob is on a different instance (or LB). His socket may still be open.");
    log("observe", "No reconnect logic exists yet — client is permanently disconnected.");

    if (bobWs.readyState === WebSocket.OPEN) {
      log("observe", "Bob still OPEN → his instance is healthy, LB is working.");
    }
  } else {
    log("observe", "Timeout — S1 was not killed within 60s. Exiting.");
  }

  aliceWs.terminate();
  bobWs.terminate();
  process.exit(0);
})();
