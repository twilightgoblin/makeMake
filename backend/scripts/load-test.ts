import { WebSocket } from "ws";

const BASE_URL = "http://localhost:8080";
const WS_URL = "ws://localhost:8080/ws";

const ROOMS_COUNT = 10;
const PARTICIPANTS_PER_ROOM = 10;
const TEST_DURATION_MS = 10000; // 10 seconds of active load

const httpMetrics = {
  requests: 0,
  success: 0,
  status429: 0,
  status4xx: 0,
  status5xx: 0,
  latencies: [] as number[],
};

const wsMetrics = {
  connectionsAttempted: 0,
  connectionsSuccessful: 0,
  connectionFailures: 0,
  messagesSent: 0,
  messagesReceived: 0,
  deliveryFailures: 0,
  latencies: [] as number[],
};

// Simple fetch wrapper to record metrics
async function measuredFetch(url: string, options: any) {
  const start = performance.now();
  httpMetrics.requests++;
  try {
    const res = await fetch(url, options);
    const end = performance.now();
    httpMetrics.latencies.push(end - start);

    if (res.ok) {
      httpMetrics.success++;
    } else if (res.status === 429) {
      httpMetrics.status429++;
    } else if (res.status >= 400 && res.status < 500) {
      httpMetrics.status4xx++;
    } else if (res.status >= 500) {
      httpMetrics.status5xx++;
    }
    return res;
  } catch (err) {
    httpMetrics.status5xx++;
    return null;
  }
}

async function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runTest() {
  console.log("🚀 Starting Load Test...");
  console.log(`Target: ${ROOMS_COUNT} rooms, ${PARTICIPANTS_PER_ROOM} participants each.`);

  const rooms: any[] = [];
  const allSockets: WebSocket[] = [];

  // Phase 1: Setup Rooms and Participants
  for (let r = 0; r < ROOMS_COUNT; r++) {
    const createRes = await measuredFetch(`${BASE_URL}/rooms`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: `Host-${r}` }),
    });
    if (!createRes || !createRes.ok) continue;

    const { room, participant: host } = await createRes.json();
    
    const guests = [];
    for (let g = 1; g < PARTICIPANTS_PER_ROOM; g++) {
      // Create guest
      const joinRes = await measuredFetch(`${BASE_URL}/rooms/${room.code}/join-requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: `Guest-${r}-${g}` }),
      });
      if (!joinRes || !joinRes.ok) continue;
      const { id: requestId } = await joinRes.json();

      // Host accepts guest
      const acceptRes = await measuredFetch(`${BASE_URL}/rooms/${room.id}/join-requests/${requestId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${host.id}` },
        body: JSON.stringify({ status: "ACCEPTED" }),
      });
      if (!acceptRes || !acceptRes.ok) continue;
      
      guests.push(await acceptRes.json());
    }

    rooms.push({ room, host, guests });
  }

  console.log(`✅ Created ${rooms.length} rooms.`);

  // Phase 2: Connect WebSockets
  const connectPromises = [];
  for (const { room, host, guests } of rooms) {
    const participants = [host, ...guests];
    for (const p of participants) {
      wsMetrics.connectionsAttempted++;
      const prm = new Promise<void>((resolve) => {
        const ws = new WebSocket(`${WS_URL}?roomId=${room.id}&participantId=${p.id}`);
        ws.on("open", () => {
          wsMetrics.connectionsSuccessful++;
          allSockets.push(ws);
          resolve();
        });
        ws.on("error", () => {
          wsMetrics.connectionFailures++;
          resolve();
        });
        ws.on("message", (data) => {
          try {
            const msg = JSON.parse(data.toString());
            if (msg.type === "CHAT_MESSAGE" && msg.payload.text.startsWith("LATENCY_TEST")) {
              const parts = msg.payload.text.split(":");
              const sentAt = parseFloat(parts[1]);
              const receivedAt = performance.now();
              wsMetrics.latencies.push(receivedAt - sentAt);
            }
            wsMetrics.messagesReceived++;
          } catch(e) {}
        });
      });
      connectPromises.push(prm);
    }
  }

  await Promise.all(connectPromises);
  console.log(`✅ Connected ${wsMetrics.connectionsSuccessful} WebSockets.`);

  // Phase 3: Active Load (Chat and Playlist)
  console.log(`🔥 Starting active load for ${TEST_DURATION_MS / 1000} seconds...`);
  const activeStart = performance.now();
  
  while (performance.now() - activeStart < TEST_DURATION_MS) {
    // Pick a random socket and send a message
    const ws = allSockets[Math.floor(Math.random() * allSockets.length)];
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: "CHAT_MESSAGE",
        payload: { text: `LATENCY_TEST:${performance.now()}` }
      }));
      wsMetrics.messagesSent++;
    }
    await delay(50); // Send ~20 messages per second total
  }

  // Teardown
  for (const ws of allSockets) {
    ws.close();
  }

  // Phase 4: Calculate and Print Metrics
  console.log("\n📊 --- HTTP Metrics ---");
  console.log(`Requests: ${httpMetrics.requests}`);
  console.log(`Success (2xx): ${httpMetrics.success}`);
  console.log(`Rate Limited (429): ${httpMetrics.status429}`);
  console.log(`Errors (4xx): ${httpMetrics.status4xx}`);
  console.log(`Errors (5xx): ${httpMetrics.status5xx}`);
  
  httpMetrics.latencies.sort((a, b) => a - b);
  const hAvg = httpMetrics.latencies.reduce((a, b) => a + b, 0) / (httpMetrics.latencies.length || 1);
  const hP95 = httpMetrics.latencies[Math.floor(httpMetrics.latencies.length * 0.95)] || 0;
  const hMin = httpMetrics.latencies[0] || 0;
  const hMax = httpMetrics.latencies[httpMetrics.latencies.length - 1] || 0;
  console.log(`Latency - Min: ${hMin.toFixed(2)}ms, Avg: ${hAvg.toFixed(2)}ms, p95: ${hP95.toFixed(2)}ms, Max: ${hMax.toFixed(2)}ms`);

  console.log("\n📡 --- WebSocket Metrics ---");
  console.log(`Attempted: ${wsMetrics.connectionsAttempted}`);
  console.log(`Successful: ${wsMetrics.connectionsSuccessful}`);
  console.log(`Failures: ${wsMetrics.connectionFailures}`);
  console.log(`Messages Sent: ${wsMetrics.messagesSent}`);
  console.log(`Messages Received: ${wsMetrics.messagesReceived}`);
  
  wsMetrics.latencies.sort((a, b) => a - b);
  const wAvg = wsMetrics.latencies.reduce((a, b) => a + b, 0) / (wsMetrics.latencies.length || 1);
  const wP95 = wsMetrics.latencies[Math.floor(wsMetrics.latencies.length * 0.95)] || 0;
  console.log(`Delivery Latency - Avg: ${wAvg.toFixed(2)}ms, p95: ${wP95.toFixed(2)}ms`);
}

runTest().catch(console.error);
