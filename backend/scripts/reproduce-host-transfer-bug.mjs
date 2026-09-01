/**
 * Phase 8.2 — Reproduce the host-transfer cross-instance bug
 *
 * Scenario:
 *   1. Create room + HOST participant (via :8080)
 *   2. HOST WebSocket connects — we force it to land on S1 (:3000)
 *   3. MEMBER connects (can land anywhere)
 *   4. HOST disconnects
 *      → S1 starts the 8-second grace timer in its pendingHostTransfers Map
 *   5. HOST reconnects — we force it to land on S2 (:3001)
 *      → S2 calls clearPendingTransfer() on its own Map (empty — wrong process)
 *      → S1's timer keeps ticking
 *   6. Wait 8+ seconds
 *      → S1's timer fires → HOST_CHANGED is published to Redis → broadcast to room
 *      → BUG: HOST was already reconnected, but MEMBER still gets HOST_CHANGED
 *
 * Expected (correct) behavior:
 *   HOST_CHANGED should NOT fire after the HOST successfully reconnects.
 *
 * Actual (buggy) behavior:
 *   HOST_CHANGED fires anyway because clearPendingTransfer() ran on the wrong instance.
 */

import WebSocket from "ws";

const LB   = "http://localhost:8080";
const WS_LB = "ws://localhost:8080/ws";

// Direct instance URLs — used to force specific backends for the repro
const S1_WS = "ws://localhost:3000/ws";
const S2_WS = "ws://localhost:3001/ws";

// ─── helpers ──────────────────────────────────────────────────────────────────

function log(who, msg) {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`[${ts}] [${who}] ${msg}`);
}

async function api(method, path, body, extraHeaders = {}) {
  const res = await fetch(`${LB}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...extraHeaders },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${method} ${path} → ${res.status}: ${text}`);
  }
  return res.json();
}

function connect(wsUrl, participantId, roomId, label) {
  return new Promise((resolve) => {
    const url = `${wsUrl}?participantId=${participantId}&roomId=${roomId}`;
    const ws = new WebSocket(url);

    ws.on("open", () => {
      log(label, `connected to ${wsUrl}`);
    });

    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      const type = msg.type ?? msg.event?.type ?? "(unknown)";

      // Highlight HOST_CHANGED — that's the bug indicator
      if (type === "HOST_CHANGED") {
        console.log("");
        console.log("╔═══════════════════════════════════════════╗");
        console.log("║  ⚠️  HOST_CHANGED received by MEMBER       ║");
        console.log("║  Bug confirmed: grace timer fired on S1    ║");
        console.log("║  even though HOST reconnected on S2        ║");
        console.log("╚═══════════════════════════════════════════╝");
        console.log("  Payload:", JSON.stringify(msg, null, 2));
        console.log("");
      } else if (type !== "ROOM_STATE") {
        log(label, `← ${type}`);
      } else {
        log(label, `← ROOM_STATE (connected)`);
        resolve(ws);
      }
    });

    ws.on("error", (err) => log(label, `ERROR: ${err.message}`));
    ws.on("close", (code) => log(label, `closed (${code})`));
  });
}

// ─── main ─────────────────────────────────────────────────────────────────────

(async () => {
  // ── Step 1: Create room ────────────────────────────────────────────────────
  log("setup", "creating room via :8080...");
  const { room, participant: host } = await api("POST", "/rooms", {
    displayName: "Alice (HOST)",
  });
  log("setup", `room=${room.id}  code=${room.code}  hostId=${host.id}`);

  // ── Step 2: Add a MEMBER via join-request ──────────────────────────────────
  log("setup", "Bob submits join request...");
  const { joinRequest } = await api(
    "POST",
    `/rooms/${room.code}/join-requests`,
    { displayName: "Bob (MEMBER)" }
  );

  log("setup", "Alice accepts Bob's join request...");
  const { participant: bob } = await api(
    "PATCH",
    `/rooms/${room.id}/join-requests/${joinRequest.id}`,
    { action: "ACCEPT" },
    { "X-Participant-Id": host.id }
  );
  log("setup", `bobId=${bob.id}`);

  // ── Step 3: HOST connects to S1 directly ──────────────────────────────────
  // We bypass the LB for the HOST's first connection so we know for certain
  // it lands on S1. The grace timer will be created in S1's memory.
  log("alice", "connecting HOST WebSocket directly to S1 (:3000)...");
  const aliceWs = await connect(S1_WS, host.id, room.id, "alice");

  // ── Step 4: MEMBER connects via LB ────────────────────────────────────────
  // Bob goes through :8080. Which instance doesn't matter for this repro.
  log("bob", "connecting MEMBER WebSocket via LB (:8080)...");
  const bobWs = await connect(WS_LB, bob.id, room.id, "bob");

  // ── Step 5: HOST disconnects ───────────────────────────────────────────────
  // S1 will now start an 8-second pendingHostTransfer timer in its own memory.
  console.log("");
  log("alice", "HOST disconnecting... (S1 will start grace timer)");
  aliceWs.close();

  // Give S1 a moment to register the disconnect and arm the timer
  await new Promise(r => setTimeout(r, 500));

  // ── Step 6: HOST reconnects — this time directly to S2 ────────────────────
  // We bypass the LB again and force S2. S2 calls clearPendingTransfer()
  // but its Map is empty — the timer lives in S1.
  console.log("");
  log("alice", "HOST reconnecting directly to S2 (:3001)...");
  log("alice", "S2 will call clearPendingTransfer() on its own empty Map");
  const aliceWs2 = await connect(S2_WS, host.id, room.id, "alice-reconnect");

  // ── Step 7: Wait for S1's grace timer to fire ─────────────────────────────
  const GRACE_MS = Number(process.env.WS_RECONNECT_GRACE_MS ?? 8_000);
  const waitMs = GRACE_MS + 2_000; // a bit past the grace window
  console.log("");
  log(
    "wait",
    `waiting ${waitMs / 1000}s for S1's grace timer to fire (WS_RECONNECT_GRACE_MS=${GRACE_MS}ms)...`
  );
  log("wait", "If the bug is present, Bob will receive HOST_CHANGED below ↓");
  console.log("");

  await new Promise(r => setTimeout(r, waitMs));

  // ── Step 8: Outcome ────────────────────────────────────────────────────────
  console.log("");
  log("result", "Grace period elapsed.");
  log("result", "If no HOST_CHANGED was printed above → bug did NOT manifest (or grace=0)");
  log("result", "If HOST_CHANGED was printed above → bug confirmed ✅");

  aliceWs2.close();
  bobWs.close();
  process.exit(0);
})();
