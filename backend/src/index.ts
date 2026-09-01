import "dotenv/config";
import express from "express";
import { prisma } from "./lib/prisma.js";
import { attachWebSocketServer } from "./ws/server.js";
import { subscribeRoomEvents } from "./lib/roomEvents.js";
import { configureRoomExpiry, subscribeRoomExpiry, rearmInactiveRooms } from "./lib/roomExpiry.js";

// Routers
import { roomsRouter } from "./routes/rooms.js";
import { joinRequestsRouter } from "./routes/joinRequests.js";
import { roomDetailRouter } from "./routes/roomDetail.js";
import { roomLifecycleRouter } from "./routes/roomLifecycle.js";
import { songsRouter } from "./routes/songs.js";
import { playlistRouter } from "./routes/playlist.js";
import { messagesRouter } from "./routes/messages.js";
import { presenceRouter } from "./routes/presence.js";

// Middleware
import { errorHandler } from "./middleware/errorHandler.js";

const app = express();
const PORT = process.env.PORT ?? 3000;

// ---------------------------------------------------------------------------
// Application configuration — resolved once before any infrastructure starts.
// Routes and lifecycle handlers import roomExpiry.ts; configureRoomExpiry()
// ensures they all see the same TTL regardless of CJS module cache behaviour.
// ---------------------------------------------------------------------------
configureRoomExpiry(Number(process.env["ROOM_INACTIVE_TTL_SECS"] ?? 300));

app.use(express.json());

// ----------------------------------------------------------------------------
// Health check
// ----------------------------------------------------------------------------
app.get("/health", async (_req, res) => {
  if (!isReady()) {
    res.status(503).json({ status: "starting" });
    return;
  }
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: "ok", db: "connected" });
  } catch (err) {
    console.error("[health] DB connection failed:", err);
    res.status(503).json({ status: "error", db: "disconnected" });
  }
});

// ----------------------------------------------------------------------------
// Debug — Phase 7.4: lightweight room status check (no auth required).
// Used only by the demo script.
// ----------------------------------------------------------------------------
app.get("/debug/room-status", async (req, res) => {
  const roomId = req.query.roomId as string | undefined;
  if (!roomId) { res.status(400).json({ error: "roomId required" }); return; }
  const room = await prisma.room.findUnique({ where: { id: roomId }, select: { id: true, status: true } });
  if (!room) { res.status(404).json({ error: "not found" }); return; }
  res.json({ roomId: room.id, status: room.status });
});

// ----------------------------------------------------------------------------
// API routes
// ----------------------------------------------------------------------------

// Songs — public, no auth
app.use("/songs", songsRouter);

// Rooms — creation (no auth) + code-scoped join requests (no auth)
app.use("/rooms", roomsRouter);

// Join-request routes live under /rooms but use different param shapes:
//   POST  /rooms/:code/join-requests  (uses :code)
//   PATCH /rooms/:id/join-requests/:requestId (uses :id)
app.use("/rooms", joinRequestsRouter);

// Room detail (GET /rooms/:id) — requires participant
app.use("/rooms", roomDetailRouter);

// Room lifecycle (DELETE /rooms/:id, PATCH /rooms/:id/participants/:pid/leave)
app.use("/rooms", roomLifecycleRouter);

// Playlist (GET/POST/DELETE/PATCH /rooms/:id/playlist/…)
app.use("/rooms", playlistRouter);

// Messages (GET /rooms/:id/messages)
app.use("/rooms", messagesRouter);

// Presence (GET /rooms/:id/presence)
app.use("/rooms", presenceRouter);

// ----------------------------------------------------------------------------
// Global error handler — must be last
// ----------------------------------------------------------------------------
app.use(errorHandler);

const httpServer = app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

attachWebSocketServer(httpServer);
subscribeRoomEvents();

// Track whether async startup tasks have completed.
// The /health endpoint waits for this before returning ok,
// ensuring the demo/test scripts don't send requests before
// Redis subscriptions are live.
let _ready = false;
export function isReady(): boolean { return _ready; }

(async () => {
  try {
    await subscribeRoomExpiry();
    await rearmInactiveRooms();
    _ready = true;
    console.log("[startup] ready");
  } catch (err) {
    console.error("[startup] room-expiry initialisation failed", err);
    _ready = true; // still mark ready so health check doesn't block forever
  }
})();
