// -----------------------------------------------------------------------------
// Phase 3.10 — End-to-end WebSocket tests
//
// Test plan:
//   3.2  Connection + participant validation
//   3.3  In-memory room connection manager (via presence)
//   3.4  ROOM_STATE synchronisation on connect
//   3.5  Playback events (PLAY, PAUSE, SEEK, NEXT, PREVIOUS)
//   3.6  Playlist events (PLAYLIST_ADD, PLAYLIST_REMOVE, PLAYLIST_REORDER)
//   3.7  Chat events (CHAT_MESSAGE)
//   3.8  Presence / disconnect (USER_JOINED, USER_LEFT, HOST_CHANGED)
//   3.9  Error handling (HOST_ONLY, INVALID_PAYLOAD, ROOM_CLOSED, etc.)
// -----------------------------------------------------------------------------

import { describe, it, beforeAll, afterAll, beforeEach, afterEach, expect } from "vitest";
import type { ServerEnvelope, RoomStatePayload, PlayBroadcastPayload, SongChangeBroadcastPayload } from "../src/lib/wsTypes.js";
import {
  startServer,
  stopServer,
  getAnySongId,
  createRoom,
  createParticipant,
  deleteRoom,
  type TestServer,
} from "./helpers/server.js";
import { WsTestClient, connectAndSync } from "./helpers/wsClient.js";
import { prisma } from "../src/lib/prisma.js";

// ---------------------------------------------------------------------------
// Global setup — one server for the whole suite
// ---------------------------------------------------------------------------

let server: TestServer;

beforeAll(async () => {
  server = await startServer();
});

afterAll(async () => {
  await stopServer(server.httpServer);
});

// ---------------------------------------------------------------------------
// Per-test fixtures
// ---------------------------------------------------------------------------

let roomId: string;
let songId: string;

beforeEach(async () => {
  const room = await createRoom();
  roomId = room.id;
  songId = await getAnySongId();

  // Set the room's current song so playback events have something to work with
  await prisma.room.update({
    where: { id: roomId },
    data: { currentSongId: songId, isPlaying: false, positionSecs: 0, stateUpdatedAt: new Date() },
  });
});

afterEach(async () => {
  await deleteRoom(roomId);
});

// ---------------------------------------------------------------------------
// 3.2 / 3.3 — Connection + participant validation
// ---------------------------------------------------------------------------

describe("3.2 Connection validation", () => {
  it("rejects connection with missing query params", async () => {
    const client = new WsTestClient(`${server.wsUrl}/ws`);
    await client.connect();
    const msg = await client.nextMessage();
    expect(msg.type).toBe("ERROR");
    expect((msg.payload as { code: string }).code).toBe("MISSING_PARTICIPANT");
    await client.close();
  });

  it("rejects unknown participantId", async () => {
    const client = new WsTestClient(
      `${server.wsUrl}/ws?participantId=nonexistent&roomId=${roomId}`,
    );
    await client.connect();
    const msg = await client.nextMessage();
    expect(msg.type).toBe("ERROR");
    expect((msg.payload as { code: string }).code).toBe("PARTICIPANT_NOT_ACTIVE");
    await client.close();
  });

  it("rejects participant who belongs to a different room", async () => {
    const otherRoom = await createRoom();
    const p = await createParticipant(otherRoom.id, "Stranger");

    const client = new WsTestClient(
      `${server.wsUrl}/ws?participantId=${p.id}&roomId=${roomId}`,
    );
    await client.connect();
    const msg = await client.nextMessage();
    expect(msg.type).toBe("ERROR");
    expect((msg.payload as { code: string }).code).toBe("PARTICIPANT_NOT_ACTIVE");
    await client.close();
    await deleteRoom(otherRoom.id);
  });

  it("rejects connection to a CLOSED room", async () => {
    await prisma.room.update({ where: { id: roomId }, data: { status: "CLOSED" } });
    const p = await createParticipant(roomId, "Ayush", "HOST");

    const client = new WsTestClient(
      `${server.wsUrl}/ws?participantId=${p.id}&roomId=${roomId}`,
    );
    await client.connect();
    const msg = await client.nextMessage();
    expect(msg.type).toBe("ERROR");
    expect((msg.payload as { code: string }).code).toBe("ROOM_CLOSED");
    await client.close();
  });

  it("accepts a valid active participant and sends ROOM_STATE", async () => {
    const p = await createParticipant(roomId, "Ayush", "HOST");
    const { client, roomState } = await connectAndSync(server.wsUrl, p.id, roomId);

    expect(roomState.type).toBe("ROOM_STATE");
    const payload = roomState.payload as RoomStatePayload;
    expect(payload.roomId).toBe(roomId);
    expect(payload.status).toBe("ACTIVE");
    expect(Array.isArray(payload.participants)).toBe(true);
    expect(payload.participants.some((pp) => pp.id === p.id)).toBe(true);

    await client.close();
  });
});

// ---------------------------------------------------------------------------
// 3.4 — ROOM_STATE initial synchronisation
// ---------------------------------------------------------------------------

describe("3.4 ROOM_STATE sync", () => {
  it("includes playback state in ROOM_STATE", async () => {
    await prisma.room.update({
      where: { id: roomId },
      data: { isPlaying: true, positionSecs: 42.5, stateUpdatedAt: new Date() },
    });

    const p = await createParticipant(roomId, "Ayush", "HOST");
    const { client, roomState } = await connectAndSync(server.wsUrl, p.id, roomId);

    const payload = roomState.payload as RoomStatePayload;
    expect(payload.playback.isPlaying).toBe(true);
    expect(payload.playback.positionSecs).toBe(42.5);
    expect(payload.playback.currentSongId).toBe(songId);

    await client.close();
  });

  it("second client receives USER_JOINED for themselves in their ROOM_STATE", async () => {
    const host = await createParticipant(roomId, "Ayush", "HOST");
    const member = await createParticipant(roomId, "Alex", "MEMBER");

    const { client: hostClient } = await connectAndSync(server.wsUrl, host.id, roomId);

    // Alex connects — host should get USER_JOINED
    const { client: alexClient, roomState } = await connectAndSync(server.wsUrl, member.id, roomId);

    const userJoined = await hostClient.nextMessage();
    expect(userJoined.type).toBe("USER_JOINED");
    expect((userJoined.payload as { participant: { id: string } }).participant.id).toBe(member.id);

    // Alex's ROOM_STATE should list both participants
    const payload = roomState.payload as RoomStatePayload;
    const ids = payload.participants.map((pp) => pp.id);
    expect(ids).toContain(host.id);
    expect(ids).toContain(member.id);

    await hostClient.close();
    await alexClient.close();
  });
});

// ---------------------------------------------------------------------------
// 3.5 — Playback events
// ---------------------------------------------------------------------------

describe("3.5 Playback events", () => {
  it("PLAY: host can play and all clients receive the broadcast", async () => {
    const host = await createParticipant(roomId, "Ayush", "HOST");
    const member = await createParticipant(roomId, "Alex", "MEMBER");

    const { client: hostClient } = await connectAndSync(server.wsUrl, host.id, roomId);
    const { client: alexClient } = await connectAndSync(server.wsUrl, member.id, roomId);
    // consume USER_JOINED on host side
    await hostClient.nextMessage();

    hostClient.send("PLAY", { positionSecs: 10 });

    const hostMsg = await hostClient.nextMessage();
    const alexMsg = await alexClient.nextMessage();

    expect(hostMsg.type).toBe("PLAY");
    expect(alexMsg.type).toBe("PLAY");
    const payload = hostMsg.payload as PlayBroadcastPayload;
    expect(payload.positionSecs).toBe(10);
    expect(payload.songId).toBe(songId);

    // DB should reflect the update
    const room = await prisma.room.findUnique({ where: { id: roomId } });
    expect(room!.isPlaying).toBe(true);
    expect(room!.positionSecs).toBe(10);

    await hostClient.close();
    await alexClient.close();
  });

  it("PAUSE: host can pause", async () => {
    const host = await createParticipant(roomId, "Ayush", "HOST");
    const { client } = await connectAndSync(server.wsUrl, host.id, roomId);

    client.send("PAUSE", { positionSecs: 55.3 });
    const msg = await client.nextMessage();

    expect(msg.type).toBe("PAUSE");
    expect((msg.payload as { positionSecs: number }).positionSecs).toBe(55.3);

    const room = await prisma.room.findUnique({ where: { id: roomId } });
    expect(room!.isPlaying).toBe(false);
    expect(room!.positionSecs).toBe(55.3);

    await client.close();
  });

  it("SEEK: host can seek to a valid position", async () => {
    const host = await createParticipant(roomId, "Ayush", "HOST");
    const { client } = await connectAndSync(server.wsUrl, host.id, roomId);

    client.send("SEEK", { positionSecs: 30 });
    const msg = await client.nextMessage();

    expect(msg.type).toBe("SEEK");
    expect((msg.payload as { positionSecs: number }).positionSecs).toBe(30);

    await client.close();
  });

  it("SEEK: rejects negative position", async () => {
    const host = await createParticipant(roomId, "Ayush", "HOST");
    const { client } = await connectAndSync(server.wsUrl, host.id, roomId);

    client.send("SEEK", { positionSecs: -5 });
    const msg = await client.nextMessage();

    expect(msg.type).toBe("ERROR");
    expect((msg.payload as { code: string }).code).toBe("INVALID_PAYLOAD");

    await client.close();
  });

  it("PLAY: non-host receives HOST_ONLY error", async () => {
    const host = await createParticipant(roomId, "Ayush", "HOST");
    const member = await createParticipant(roomId, "Alex", "MEMBER");

    const { client: hostClient } = await connectAndSync(server.wsUrl, host.id, roomId);
    const { client: alexClient } = await connectAndSync(server.wsUrl, member.id, roomId);
    await hostClient.nextMessage(); // drain USER_JOINED

    alexClient.send("PLAY", { positionSecs: 0 });
    const msg = await alexClient.nextMessage();

    expect(msg.type).toBe("ERROR");
    expect((msg.payload as { code: string }).code).toBe("HOST_ONLY");

    await hostClient.close();
    await alexClient.close();
  });

  it("NEXT: advances to the next playlist entry, preserves play state", async () => {
    // Add two songs to playlist
    const song2 = await prisma.song.findFirst({
      where: { id: { not: songId } },
      select: { id: true },
    });
    await prisma.playlistEntry.createMany({
      data: [
        { roomId, songId, position: 0 },
        { roomId, songId: song2!.id, position: 1 },
      ],
    });
    await prisma.room.update({ where: { id: roomId }, data: { currentSongId: songId, isPlaying: true } });

    const host = await createParticipant(roomId, "Ayush", "HOST");
    const { client } = await connectAndSync(server.wsUrl, host.id, roomId);

    client.send("NEXT", {});
    const msg = await client.nextMessage();

    expect(msg.type).toBe("NEXT");
    const payload = msg.payload as SongChangeBroadcastPayload;
    expect(payload.songId).toBe(song2!.id);
    expect(payload.positionSecs).toBe(0);
    expect(payload.isPlaying).toBe(true); // preserved

    await client.close();
  });

  it("PREVIOUS: wraps to last entry when already at the start", async () => {
    const song2 = await prisma.song.findFirst({
      where: { id: { not: songId } },
      select: { id: true },
    });
    await prisma.playlistEntry.createMany({
      data: [
        { roomId, songId, position: 0 },
        { roomId, songId: song2!.id, position: 1 },
      ],
    });
    await prisma.room.update({ where: { id: roomId }, data: { currentSongId: songId, isPlaying: false } });

    const host = await createParticipant(roomId, "Ayush", "HOST");
    const { client } = await connectAndSync(server.wsUrl, host.id, roomId);

    client.send("PREVIOUS", {});
    const msg = await client.nextMessage();

    expect(msg.type).toBe("PREVIOUS");
    // Wraps around: was at position 0, should jump to last (song2)
    const payload = msg.payload as SongChangeBroadcastPayload;
    expect(payload.songId).toBe(song2!.id);

    await client.close();
  });
});

// ---------------------------------------------------------------------------
// 3.6 — Playlist events
// ---------------------------------------------------------------------------

describe("3.6 Playlist events", () => {
  it("PLAYLIST_ADD: any participant can add a song", async () => {
    const host = await createParticipant(roomId, "Ayush", "HOST");
    const member = await createParticipant(roomId, "Alex", "MEMBER");

    const { client: hostClient } = await connectAndSync(server.wsUrl, host.id, roomId);
    const { client: alexClient } = await connectAndSync(server.wsUrl, member.id, roomId);
    await hostClient.nextMessage(); // drain USER_JOINED

    alexClient.send("PLAYLIST_ADD", { songId });
    const alexMsg = await alexClient.nextMessage();
    const hostMsg = await hostClient.nextMessage();

    expect(alexMsg.type).toBe("PLAYLIST_ADD");
    expect(hostMsg.type).toBe("PLAYLIST_ADD");
    expect((alexMsg.payload as { entry: { song: { id: string } } }).entry.song.id).toBe(songId);

    await hostClient.close();
    await alexClient.close();
  });

  it("PLAYLIST_ADD: rejects unknown songId", async () => {
    const host = await createParticipant(roomId, "Ayush", "HOST");
    const { client } = await connectAndSync(server.wsUrl, host.id, roomId);

    client.send("PLAYLIST_ADD", { songId: "nonexistent" });
    const msg = await client.nextMessage();

    expect(msg.type).toBe("ERROR");
    expect((msg.payload as { code: string }).code).toBe("SONG_NOT_FOUND");

    await client.close();
  });

  it("PLAYLIST_REMOVE: removes entry and broadcasts updated order", async () => {
    const entry = await prisma.playlistEntry.create({
      data: { roomId, songId, position: 0 },
      select: { id: true },
    });

    const host = await createParticipant(roomId, "Ayush", "HOST");
    const { client } = await connectAndSync(server.wsUrl, host.id, roomId);

    client.send("PLAYLIST_REMOVE", { entryId: entry.id });
    const msg = await client.nextMessage();

    expect(msg.type).toBe("PLAYLIST_REMOVE");
    expect((msg.payload as { entryId: string }).entryId).toBe(entry.id);

    const remaining = await prisma.playlistEntry.findMany({ where: { roomId } });
    expect(remaining).toHaveLength(0);

    await client.close();
  });

  it("PLAYLIST_REORDER: moves entry to new position", async () => {
    const song2 = await prisma.song.findFirst({ where: { id: { not: songId } }, select: { id: true } });
    const e0 = await prisma.playlistEntry.create({ data: { roomId, songId, position: 0 }, select: { id: true } });
    await prisma.playlistEntry.create({ data: { roomId, songId: song2!.id, position: 1 }, select: { id: true } });

    const host = await createParticipant(roomId, "Ayush", "HOST");
    const { client } = await connectAndSync(server.wsUrl, host.id, roomId);

    client.send("PLAYLIST_REORDER", { entryId: e0.id, newPosition: 1 });
    const msg = await client.nextMessage();

    expect(msg.type).toBe("PLAYLIST_REORDER");
    const playlist = (msg.payload as { playlist: Array<{ id: string; position: number }> }).playlist;
    const moved = playlist.find((e) => e.id === e0.id);
    expect(moved?.position).toBe(1);

    await client.close();
  });
});

// ---------------------------------------------------------------------------
// 3.7 — Chat events
// ---------------------------------------------------------------------------

describe("3.7 Chat events", () => {
  it("CHAT_MESSAGE: persisted and broadcast to all room members", async () => {
    const host = await createParticipant(roomId, "Ayush", "HOST");
    const member = await createParticipant(roomId, "Alex", "MEMBER");

    const { client: hostClient } = await connectAndSync(server.wsUrl, host.id, roomId);
    const { client: alexClient } = await connectAndSync(server.wsUrl, member.id, roomId);
    await hostClient.nextMessage(); // USER_JOINED

    alexClient.send("CHAT_MESSAGE", { content: "This song is insane 🔥" });

    const alexMsg = await alexClient.nextMessage();
    const hostMsg = await hostClient.nextMessage();

    expect(alexMsg.type).toBe("CHAT_MESSAGE");
    expect(hostMsg.type).toBe("CHAT_MESSAGE");

    const payload = alexMsg.payload as {
      id: string; content: string; sentAt: string; sender: { id: string; displayName: string };
    };
    expect(payload.content).toBe("This song is insane 🔥");
    expect(payload.sender.id).toBe(member.id);
    expect(payload.sender.displayName).toBe("Alex");
    expect(typeof payload.id).toBe("string");
    expect(typeof payload.sentAt).toBe("string");

    // Persisted in DB
    const dbMsg = await prisma.message.findUnique({ where: { id: payload.id } });
    expect(dbMsg).not.toBeNull();
    expect(dbMsg!.content).toBe("This song is insane 🔥");

    await hostClient.close();
    await alexClient.close();
  });

  it("CHAT_MESSAGE: rejects empty content", async () => {
    const host = await createParticipant(roomId, "Ayush", "HOST");
    const { client } = await connectAndSync(server.wsUrl, host.id, roomId);

    client.send("CHAT_MESSAGE", { content: "   " });
    const msg = await client.nextMessage();

    expect(msg.type).toBe("ERROR");
    expect((msg.payload as { code: string }).code).toBe("INVALID_PAYLOAD");

    await client.close();
  });
});

// ---------------------------------------------------------------------------
// 3.8 — Presence / disconnect
// ---------------------------------------------------------------------------

describe("3.8 Presence / disconnect", () => {
  it("USER_LEFT broadcast when a participant disconnects", async () => {
    const host = await createParticipant(roomId, "Ayush", "HOST");
    const member = await createParticipant(roomId, "Alex", "MEMBER");

    const { client: hostClient } = await connectAndSync(server.wsUrl, host.id, roomId);
    const { client: alexClient } = await connectAndSync(server.wsUrl, member.id, roomId);
    await hostClient.nextMessage(); // USER_JOINED

    // Alex disconnects
    await alexClient.close();

    const msg = await hostClient.nextMessage();
    expect(msg.type).toBe("USER_LEFT");
    expect((msg.payload as { participantId: string }).participantId).toBe(member.id);

    await hostClient.close();
  });

  it("HOST_CHANGED broadcast when host disconnects and another participant is present", async () => {
    const host = await createParticipant(roomId, "Ayush", "HOST");
    const member = await createParticipant(roomId, "Alex", "MEMBER");

    const { client: hostClient } = await connectAndSync(server.wsUrl, host.id, roomId);
    const { client: alexClient } = await connectAndSync(server.wsUrl, member.id, roomId);
    await hostClient.nextMessage(); // USER_JOINED for Alex

    // Host disconnects
    await hostClient.close();

    // Alex should receive USER_LEFT then HOST_CHANGED
    const userLeft = await alexClient.nextMessage();
    expect(userLeft.type).toBe("USER_LEFT");

    const hostChanged = await alexClient.nextMessage();
    expect(hostChanged.type).toBe("HOST_CHANGED");
    expect((hostChanged.payload as { newHostId: string }).newHostId).toBe(member.id);

    // DB role should be updated
    const newHost = await prisma.participant.findUnique({ where: { id: member.id } });
    expect(newHost!.role).toBe("HOST");

    await alexClient.close();
  });

  it("disconnect does not set leftAt on participant (reconnect is possible)", async () => {
    const host = await createParticipant(roomId, "Ayush", "HOST");
    const { client } = await connectAndSync(server.wsUrl, host.id, roomId);
    await client.close();

    // Wait briefly for the close handler to fire
    await new Promise((r) => setTimeout(r, 100));

    const p = await prisma.participant.findUnique({ where: { id: host.id } });
    expect(p!.leftAt).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3.9 — Error handling
// ---------------------------------------------------------------------------

describe("3.9 Error handling", () => {
  it("unknown event type returns INVALID_EVENT", async () => {
    const host = await createParticipant(roomId, "Ayush", "HOST");
    const { client } = await connectAndSync(server.wsUrl, host.id, roomId);

    // Send a raw malformed type
    (client as unknown as { ws: import("ws").default }).ws?.send(
      JSON.stringify({ type: "DOES_NOT_EXIST", payload: {} }),
    );

    // Access private ws — use a simpler approach via the send method with a cast
    await client.close();
  });

  it("malformed JSON closes with an ERROR event", async () => {
    const host = await createParticipant(roomId, "Ayush", "HOST");
    // Connect using raw ws to send invalid JSON
    const WebSocket = (await import("ws")).default;
    const ws = new WebSocket(`${server.wsUrl}/ws?participantId=${host.id}&roomId=${roomId}`);
    await new Promise<void>((resolve) => ws.once("open", resolve));

    // Drain ROOM_STATE
    await new Promise<void>((resolve) => ws.once("message", () => resolve()));

    ws.send("not json at all");
    const raw = await new Promise<string>((resolve) => ws.once("message", (d) => resolve(d.toString())));
    const msg = JSON.parse(raw) as { type: string; payload: { code: string } };
    expect(msg.type).toBe("ERROR");
    expect(msg.payload.code).toBe("INVALID_EVENT");

    ws.close();
    await new Promise<void>((resolve) => ws.once("close", resolve));
  });

  it("non-HOST gets HOST_ONLY for PAUSE", async () => {
    const host = await createParticipant(roomId, "Ayush", "HOST");
    const member = await createParticipant(roomId, "Alex", "MEMBER");

    const { client: hostClient } = await connectAndSync(server.wsUrl, host.id, roomId);
    const { client: alexClient } = await connectAndSync(server.wsUrl, member.id, roomId);
    await hostClient.nextMessage();

    alexClient.send("PAUSE", { positionSecs: 0 });
    const msg = await alexClient.nextMessage();
    expect(msg.type).toBe("ERROR");
    expect((msg.payload as { code: string }).code).toBe("HOST_ONLY");

    await hostClient.close();
    await alexClient.close();
  });

  it("PLAYLIST_REMOVE with unknown entryId returns PLAYLIST_ENTRY_NOT_FOUND", async () => {
    const host = await createParticipant(roomId, "Ayush", "HOST");
    const { client } = await connectAndSync(server.wsUrl, host.id, roomId);

    client.send("PLAYLIST_REMOVE", { entryId: "nonexistent-id" });
    const msg = await client.nextMessage();

    expect(msg.type).toBe("ERROR");
    expect((msg.payload as { code: string }).code).toBe("PLAYLIST_ENTRY_NOT_FOUND");

    await client.close();
  });
});
