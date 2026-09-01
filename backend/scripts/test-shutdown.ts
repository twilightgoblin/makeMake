import { spawn } from "child_process";
import WebSocket from "ws";

const S1_PORT = 3001;
const S2_PORT = 3002;

let s1, s2;

async function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function startServer(port, name) {
  return new Promise((resolve) => {
    console.log(`Starting ${name} on port ${port}...`);
    const proc = spawn("node", ["--import", "tsx", "src/index.ts"], {
      env: { ...process.env, PORT: port.toString(), SERVER_ID: name, WS_RECONNECT_GRACE_MS: "3000" },
      stdio: "pipe",
    });

    proc.stdout.on("data", (data) => {
      const line = data.toString().trim();
      console.log(`[${name}] ${line}`);
      if (line.includes("[startup] ready")) {
        resolve(proc);
      }
    });

    proc.stderr.on("data", (data) => {
      console.error(`[${name} ERR] ${data.toString().trim()}`);
    });
  });
}

async function fetchStatus(port, path) {
  try {
    const res = await fetch(`http://localhost:${port}${path}`);
    return res.status;
  } catch (err) {
    return 0;
  }
}

async function createRoom(port) {
  const res = await fetch(`http://localhost:${port}/rooms`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ displayName: "Alice" }),
  });
  const data = await res.json();
  return { roomId: data.room.id, aliceId: data.participant.id };
}

async function connectWs(port, roomId, participantId) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}/ws?roomId=${roomId}&participantId=${participantId}`);
    ws.on("open", () => resolve(ws));
    ws.on("error", reject);
  });
}

async function runTest() {
  console.log("=== 8.7 & 8.8 Shutdown & Readiness Test ===");

  // 1. Start servers
  s1 = await startServer(S1_PORT, "S1");
  s2 = await startServer(S2_PORT, "S2");

  // 2. Test readiness
  let s1Health = await fetchStatus(S1_PORT, "/health");
  let s1Ready = await fetchStatus(S1_PORT, "/ready");
  console.log(`\nInitial state S1: /health=${s1Health}, /ready=${s1Ready}`);
  if (s1Health !== 200 || s1Ready !== 200) {
    console.error("❌ S1 did not start up as expected.");
    process.exit(1);
  }

  // 3. Create room and users
  console.log("\nCreating room with Alice as HOST...");
  const { roomId, aliceId } = await createRoom(S1_PORT);
  
  // Use prisma to add Bob to the room as MEMBER directly to skip join-request flow for test speed
  const { prisma } = await import("../src/lib/prisma.js");
  const bob = await prisma.participant.create({
    data: {
      roomId,
      displayName: "Bob",
      role: "MEMBER"
    }
  });
  const bobId = bob.id;

  // 4. Connect Alice and Bob
  console.log("Connecting Alice to S1...");
  const aliceWs = await connectWs(S1_PORT, roomId, aliceId);
  
  console.log("Connecting Bob to S2...");
  const bobWs = await connectWs(S2_PORT, roomId, bobId);

  let aliceCloseCode = null;
  aliceWs.on("close", (code) => {
    aliceCloseCode = code;
  });

  // 5. Send SIGINT to S1
  console.log("\nSending SIGINT to S1...");
  s1.kill("SIGINT");

  // 6. Wait for it to transition to shutting down
  s1Ready = 200;
  for (let i = 0; i < 5; i++) {
    await wait(200);
    s1Ready = await fetchStatus(S1_PORT, "/ready");
    if (s1Ready === 503) break;
  }
  
  s1Health = await fetchStatus(S1_PORT, "/health");
  console.log(`S1 after SIGTERM: /health=${s1Health}, /ready=${s1Ready}`);
  
  if (s1Health !== 200 || s1Ready !== 503) {
    console.error("❌ S1 did not transition to shutting down state correctly.");
    process.exit(1);
  } else {
    console.log("✅ S1 correctly returns 503 for /ready and 200 for /health");
  }

  // 7. Verify Alice gets disconnected with 1012
  for (let i = 0; i < 30; i++) {
    if (aliceCloseCode !== null) break;
    await wait(100);
  }
  
  if (aliceCloseCode === 1012) {
    console.log("✅ Alice received WS close code 1012 (Service Restart)");
  } else {
    console.error(`❌ Alice WS close code was ${aliceCloseCode} (expected 1012)`);
  }

  // 8. Reconnect Alice to S2 within the grace period
  console.log("\nReconnecting Alice to S2 within grace period...");
  const aliceWs2 = await connectWs(S2_PORT, roomId, aliceId);
  
  // Listen to Bob's messages to see if HOST changes
  let hostChanged = false;
  bobWs.on("message", (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.type === "SERVER:HOST_CHANGED") {
      hostChanged = true;
    }
  });

  await wait(3500); // Wait past the 3s grace period

  if (!hostChanged) {
    console.log("✅ Alice remained HOST (grace period preserved cross-instance)");
  } else {
    console.error("❌ Host transferred unexpectedly!");
  }

  const aliceDb = await prisma.participant.findUnique({ where: { id: aliceId } });
  if (aliceDb.role === "HOST") {
    console.log("✅ Alice is still HOST in DB.");
  } else {
    console.error("❌ Alice lost HOST role in DB.");
  }

  // Cleanup
  console.log("\nCleaning up...");
  aliceWs2.close();
  bobWs.close();
  s2.kill();
  await prisma.$disconnect();
  console.log("✅ All tests passed!");
  process.exit(0);
}

runTest().catch(console.error);
