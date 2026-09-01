// -----------------------------------------------------------------------------
// Test helper — boots the full Express + WebSocket server on a random port
// and tears it down after each suite.
//
// Usage:
//   const { httpServer, baseUrl, wsUrl } = await startServer();
//   // ... test ...
//   await stopServer(httpServer);
// -----------------------------------------------------------------------------

import "dotenv/config";
import http from "http";
import express from "express";
import { prisma } from "../../src/lib/prisma.js";
import { roomsRouter } from "../../src/routes/rooms.js";
import { joinRequestsRouter } from "../../src/routes/joinRequests.js";
import { roomDetailRouter } from "../../src/routes/roomDetail.js";
import { roomLifecycleRouter } from "../../src/routes/roomLifecycle.js";
import { songsRouter } from "../../src/routes/songs.js";
import { playlistRouter } from "../../src/routes/playlist.js";
import { messagesRouter } from "../../src/routes/messages.js";
import { errorHandler } from "../../src/middleware/errorHandler.js";
import { attachWebSocketServer } from "../../src/ws/server.js";
import { subscribeRoomEvents } from "../../src/lib/roomEvents.js";
import { configureRoomExpiry, subscribeRoomExpiry } from "../../src/lib/roomExpiry.js";

export interface TestServer {
  httpServer: http.Server;
  baseUrl: string;
  wsUrl: string;
}

export async function startServer(): Promise<TestServer> {
  const app = express();
  app.use(express.json());

  app.get("/health", (_req, res) => { res.json({ status: "ok" }); });
  app.use("/songs", songsRouter);
  app.use("/rooms", roomsRouter);
  app.use("/rooms", joinRequestsRouter);
  app.use("/rooms", roomDetailRouter);
  app.use("/rooms", roomLifecycleRouter);
  app.use("/rooms", playlistRouter);
  app.use("/rooms", messagesRouter);
  app.use(errorHandler);

  const httpServer = http.createServer(app);
  attachWebSocketServer(httpServer);

  // Wire Redis pub/sub so WS broadcasts work in tests (same as production).
  // configureRoomExpiry uses TTL=0 in tests so no accidental expiry side effects.
  configureRoomExpiry(Number(process.env["ROOM_INACTIVE_TTL_SECS"] ?? 300));
  subscribeRoomEvents();
  await subscribeRoomExpiry();

  await new Promise<void>((resolve) => {
    // Port 0 → OS picks a free port
    httpServer.listen(0, "127.0.0.1", resolve);
  });

  const addr = httpServer.address() as { port: number };
  const port = addr.port;

  return {
    httpServer,
    baseUrl: `http://127.0.0.1:${port}`,
    wsUrl: `ws://127.0.0.1:${port}`,
  };
}

export async function stopServer(httpServer: http.Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    httpServer.close((err) => (err ? reject(err) : resolve()));
  });
}

// ---------------------------------------------------------------------------
// DB helpers — seed / clean test data
// ---------------------------------------------------------------------------

/** Returns a seeded song id (first song from the library). */
export async function getAnySongId(): Promise<string> {
  const song = await prisma.song.findFirst({ select: { id: true } });
  if (!song) throw new Error("No songs in DB — run `npm run seed` first.");
  return song.id;
}

/** Creates a room and returns its id + code. */
export async function createRoom(): Promise<{ id: string; code: string }> {
  const room = await prisma.room.create({
    data: { code: `TEST-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}` },
    select: { id: true, code: true },
  });
  return room;
}

/** Creates an active participant in a room. */
export async function createParticipant(
  roomId: string,
  displayName: string,
  role: "HOST" | "MEMBER" = "MEMBER",
): Promise<{ id: string; displayName: string; role: string }> {
  const p = await prisma.participant.create({
    data: { roomId, displayName, role },
    select: { id: true, displayName: true, role: true },
  });
  return p;
}

/** Deletes a room and all its cascade-deleted children. */
export async function deleteRoom(roomId: string): Promise<void> {
  await prisma.room.delete({ where: { id: roomId } }).catch(() => {/* already gone */});
}

/**
 * Creates a pending join request for a room (by code) and returns its id.
 * Bypasses HTTP so tests that don't care about the POST flow can skip it.
 */
export async function createJoinRequest(
  roomId: string,
  displayName: string,
): Promise<{ id: string; displayName: string; status: string; roomId: string }> {
  const jr = await prisma.joinRequest.create({
    data: { roomId, displayName },
    select: { id: true, displayName: true, status: true, roomId: true },
  });
  return jr;
}
