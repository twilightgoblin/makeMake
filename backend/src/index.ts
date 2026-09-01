import "dotenv/config";
import express from "express";
import { prisma } from "./lib/prisma.js";
import { attachWebSocketServer } from "./ws/server.js";

// Routers
import { roomsRouter } from "./routes/rooms.js";
import { joinRequestsRouter } from "./routes/joinRequests.js";
import { roomDetailRouter } from "./routes/roomDetail.js";
import { roomLifecycleRouter } from "./routes/roomLifecycle.js";
import { songsRouter } from "./routes/songs.js";
import { playlistRouter } from "./routes/playlist.js";
import { messagesRouter } from "./routes/messages.js";

// Middleware
import { errorHandler } from "./middleware/errorHandler.js";

const app = express();
const PORT = process.env.PORT ?? 3000;

app.use(express.json());

// ----------------------------------------------------------------------------
// Health check
// ----------------------------------------------------------------------------
app.get("/health", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: "ok", db: "connected" });
  } catch (err) {
    console.error("[health] DB connection failed:", err);
    res.status(503).json({ status: "error", db: "disconnected" });
  }
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

// ----------------------------------------------------------------------------
// Global error handler — must be last
// ----------------------------------------------------------------------------
app.use(errorHandler);

const httpServer = app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

attachWebSocketServer(httpServer);
