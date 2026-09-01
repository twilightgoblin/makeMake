"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isReady = isReady;
require("dotenv/config");
const express_1 = __importDefault(require("express"));
const prisma_js_1 = require("./lib/prisma.js");
const server_js_1 = require("./ws/server.js");
const roomEvents_js_1 = require("./lib/roomEvents.js");
const roomExpiry_js_1 = require("./lib/roomExpiry.js");
const redis_js_1 = require("./lib/redis.js");
// Routers
const rooms_js_1 = require("./routes/rooms.js");
const joinRequests_js_1 = require("./routes/joinRequests.js");
const roomDetail_js_1 = require("./routes/roomDetail.js");
const roomLifecycle_js_1 = require("./routes/roomLifecycle.js");
const songs_js_1 = require("./routes/songs.js");
const playlist_js_1 = require("./routes/playlist.js");
const messages_js_1 = require("./routes/messages.js");
const presence_js_1 = require("./routes/presence.js");
// Middleware
const errorHandler_js_1 = require("./middleware/errorHandler.js");
const app = (0, express_1.default)();
const PORT = process.env.PORT ?? 3000;
// ---------------------------------------------------------------------------
// Application configuration — resolved once before any infrastructure starts.
// Routes and lifecycle handlers import roomExpiry.ts; configureRoomExpiry()
// ensures they all see the same TTL regardless of CJS module cache behaviour.
// ---------------------------------------------------------------------------
(0, roomExpiry_js_1.configureRoomExpiry)(Number(process.env["ROOM_INACTIVE_TTL_SECS"] ?? 300));
app.use(express_1.default.json());
let _isShuttingDown = false;
// ----------------------------------------------------------------------------
// Health / Readiness
// ----------------------------------------------------------------------------
app.get("/health", (_req, res) => {
    res.json({ status: "alive" });
});
app.get("/ready", async (_req, res) => {
    if (!isReady() || _isShuttingDown) {
        res.status(503).json({ status: _isShuttingDown ? "shutting_down" : "starting" });
        return;
    }
    try {
        await prisma_js_1.prisma.$queryRaw `SELECT 1`;
        res.json({ status: "ok", db: "connected" });
    }
    catch (err) {
        console.error("[ready] DB connection failed:", err);
        res.status(503).json({ status: "error", db: "disconnected" });
    }
});
// ----------------------------------------------------------------------------
// Debug — Phase 7.4: lightweight room status check (no auth required).
// Used only by the demo script.
// ----------------------------------------------------------------------------
app.get("/debug/room-status", async (req, res) => {
    const roomId = req.query.roomId;
    if (!roomId) {
        res.status(400).json({ error: "roomId required" });
        return;
    }
    const room = await prisma_js_1.prisma.room.findUnique({ where: { id: roomId }, select: { id: true, status: true } });
    if (!room) {
        res.status(404).json({ error: "not found" });
        return;
    }
    res.json({ roomId: room.id, status: room.status });
});
// ----------------------------------------------------------------------------
// API routes
// ----------------------------------------------------------------------------
// Songs — public, no auth
app.use("/songs", songs_js_1.songsRouter);
// Rooms — creation (no auth) + code-scoped join requests (no auth)
app.use("/rooms", rooms_js_1.roomsRouter);
// Join-request routes live under /rooms but use different param shapes:
//   POST  /rooms/:code/join-requests  (uses :code)
//   PATCH /rooms/:id/join-requests/:requestId (uses :id)
app.use("/rooms", joinRequests_js_1.joinRequestsRouter);
// Room detail (GET /rooms/:id) — requires participant
app.use("/rooms", roomDetail_js_1.roomDetailRouter);
// Room lifecycle (DELETE /rooms/:id, PATCH /rooms/:id/participants/:pid/leave)
app.use("/rooms", roomLifecycle_js_1.roomLifecycleRouter);
// Playlist (GET/POST/DELETE/PATCH /rooms/:id/playlist/…)
app.use("/rooms", playlist_js_1.playlistRouter);
// Messages (GET /rooms/:id/messages)
app.use("/rooms", messages_js_1.messagesRouter);
// Presence (GET /rooms/:id/presence)
app.use("/rooms", presence_js_1.presenceRouter);
// ----------------------------------------------------------------------------
// Global error handler — must be last
// ----------------------------------------------------------------------------
app.use(errorHandler_js_1.errorHandler);
const httpServer = app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
(0, server_js_1.attachWebSocketServer)(httpServer);
(0, roomEvents_js_1.subscribeRoomEvents)();
// Track whether async startup tasks have completed.
// The /health endpoint waits for this before returning ok,
// ensuring the demo/test scripts don't send requests before
// Redis subscriptions are live.
let _ready = false;
function isReady() { return _ready; }
(async () => {
    try {
        await (0, roomExpiry_js_1.subscribeRoomExpiry)();
        await (0, roomExpiry_js_1.rearmInactiveRooms)();
        _ready = true;
        console.log("[startup] ready");
    }
    catch (err) {
        console.error("[startup] room-expiry initialisation failed", err);
        _ready = true; // still mark ready so health check doesn't block forever
    }
})();
// ----------------------------------------------------------------------------
// Graceful Shutdown (Phase 8.7)
// ----------------------------------------------------------------------------
let isShuttingDown = false;
async function gracefulShutdown(signal) {
    if (isShuttingDown)
        return;
    isShuttingDown = true;
    _isShuttingDown = true; // mark /ready as 503
    console.log(`\n[shutdown] Received ${signal}, starting graceful shutdown...`);
    // Allow LB to notice the 503 and stop routing new requests before we drain
    await new Promise(resolve => setTimeout(resolve, 2000));
    // Timeout to forcefully exit if graceful shutdown takes too long
    setTimeout(() => {
        console.error("[shutdown] Graceful shutdown timed out after 10s, forcing exit");
        process.exit(1);
    }, 10000).unref();
    // 1. Stop accepting new HTTP connections (and wait for active ones to drain)
    console.log("[shutdown] Closing HTTP server...");
    httpServer.close();
    // 2. Close all active WebSockets gracefully
    console.log("[shutdown] Closing WebSockets...");
    (0, server_js_1.closeAllWebSockets)();
    // 3. Close Redis connections
    console.log("[shutdown] Disconnecting Redis...");
    await (0, redis_js_1.closeRedisConnections)();
    // 4. Disconnect Prisma
    console.log("[shutdown] Disconnecting PostgreSQL...");
    await prisma_js_1.prisma.$disconnect();
    console.log("[shutdown] Shutdown complete. Exiting.");
    process.exit(0);
}
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
//# sourceMappingURL=index.js.map