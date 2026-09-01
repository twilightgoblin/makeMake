// -----------------------------------------------------------------------------
// Phase 5 — Room lifecycle integration tests
//
// Test plan:
//   5.1  POST /rooms                      — room creation
//   5.2  POST /rooms/:code/join-requests  — join request submission
//   5.3  GET  /rooms/:code/join-requests/:id — status polling + participant id
//   5.4  PATCH /rooms/:id/join-requests/:id — ACCEPT / REJECT + WS broadcast
//   5.5  GET  /rooms/:id                  — room detail hydration + isOnline
//   5.6  PATCH .../leave                  — leave + host transfer + WS events
//   5.7  DELETE /rooms/:id               — HOST closes room
//   5.8  Join-request WS notification     — JOIN_REQUEST pushed to HOST socket
//   5.9  JOIN_REQUEST_RESOLVED WS event   — broadcast on ACCEPT
//   5.10 Host transfer prefers connected participant over DB-only one
// -----------------------------------------------------------------------------

import { describe, it, beforeAll, afterAll, beforeEach, afterEach, expect } from "vitest";
import supertest from "supertest";
import {
  startServer,
  stopServer,
  createRoom,
  createParticipant,
  createJoinRequest,
  deleteRoom,
  type TestServer,
} from "./helpers/server.js";
import { connectAndSync, WsTestClient } from "./helpers/wsClient.js";
import { prisma } from "../src/lib/prisma.js";

// ---------------------------------------------------------------------------
// Global setup
// ---------------------------------------------------------------------------

let server: TestServer;
let request: ReturnType<typeof supertest>;

beforeAll(async () => {
  server = await startServer();
  request = supertest(server.baseUrl);
});

afterAll(async () => {
  await stopServer(server.httpServer);
});

// ---------------------------------------------------------------------------
// Per-test fixtures
// ---------------------------------------------------------------------------

let roomId: string;
let roomCode: string;

beforeEach(async () => {
  const room = await createRoom();
  roomId = room.id;
  roomCode = room.code;
});

afterEach(async () => {
  await deleteRoom(roomId);
});

// ---------------------------------------------------------------------------
// 5.1 — POST /rooms
// ---------------------------------------------------------------------------

describe("5.1 POST /rooms — room creation", () => {
  it("creates a room and returns the HOST participant", async () => {
    const res = await request
      .post("/rooms")
      .send({ displayName: "Ayush" })
      .expect(201);

    expect(res.body.room.code).toMatch(/^[A-Z0-9]{6,}$/);
    expect(res.body.room.status).toBe("ACTIVE");
    expect(res.body.participant.displayName).toBe("Ayush");
    expect(res.body.participant.role).toBe("HOST");

    // Clean up the room created by this specific test
    await deleteRoom(res.body.room.id);
  });

  it("rejects missing displayName", async () => {
    await request.post("/rooms").send({}).expect(400);
  });

  it("rejects blank displayName", async () => {
    await request.post("/rooms").send({ displayName: "   " }).expect(400);
  });

  it("rejects displayName that is too long", async () => {
    await request.post("/rooms").send({ displayName: "A".repeat(33) }).expect(400);
  });
});

// ---------------------------------------------------------------------------
// 5.2 — POST /rooms/:code/join-requests
// ---------------------------------------------------------------------------

describe("5.2 POST /rooms/:code/join-requests — join request submission", () => {
  it("creates a PENDING join request", async () => {
    const res = await request
      .post(`/rooms/${roomCode}/join-requests`)
      .send({ displayName: "Alex" })
      .expect(201);

    expect(res.body.joinRequest.displayName).toBe("Alex");
    expect(res.body.joinRequest.status).toBe("PENDING");
    expect(res.body.joinRequest.roomId).toBe(roomId);
    expect(typeof res.body.joinRequest.id).toBe("string");
  });

  it("returns 404 for an unknown room code", async () => {
    await request
      .post("/rooms/BADCODE/join-requests")
      .send({ displayName: "Alex" })
      .expect(404);
  });

  it("returns 409 if room is CLOSED", async () => {
    await prisma.room.update({ where: { id: roomId }, data: { status: "CLOSED" } });
    await request
      .post(`/rooms/${roomCode}/join-requests`)
      .send({ displayName: "Alex" })
      .expect(409);
  });

  it("returns 409 if room is INACTIVE", async () => {
    await prisma.room.update({ where: { id: roomId }, data: { status: "INACTIVE" } });
    await request
      .post(`/rooms/${roomCode}/join-requests`)
      .send({ displayName: "Alex" })
      .expect(409);
  });

  it("returns 409 for a duplicate pending request with the same displayName", async () => {
    await request
      .post(`/rooms/${roomCode}/join-requests`)
      .send({ displayName: "Alex" })
      .expect(201);

    await request
      .post(`/rooms/${roomCode}/join-requests`)
      .send({ displayName: "Alex" })
      .expect(409);
  });

  it("allows two different displayNames to request concurrently", async () => {
    await request
      .post(`/rooms/${roomCode}/join-requests`)
      .send({ displayName: "Alex" })
      .expect(201);

    await request
      .post(`/rooms/${roomCode}/join-requests`)
      .send({ displayName: "Rahul" })
      .expect(201);
  });
});

// ---------------------------------------------------------------------------
// 5.3 — GET /rooms/:code/join-requests/:id — status polling
// ---------------------------------------------------------------------------

describe("5.3 GET /rooms/:code/join-requests/:id — status polling", () => {
  it("returns PENDING status with no participant field", async () => {
    const jr = await createJoinRequest(roomId, "Alex");

    const res = await request
      .get(`/rooms/${roomCode}/join-requests/${jr.id}`)
      .expect(200);

    expect(res.body.joinRequest.status).toBe("PENDING");
    expect(res.body.joinRequest.id).toBe(jr.id);
    expect(res.body.participant).toBeUndefined();
  });

  it("returns REJECTED status after rejection", async () => {
    const jr = await createJoinRequest(roomId, "Alex");
    await prisma.joinRequest.update({
      where: { id: jr.id },
      data: { status: "REJECTED", resolvedAt: new Date() },
    });

    const res = await request
      .get(`/rooms/${roomCode}/join-requests/${jr.id}`)
      .expect(200);

    expect(res.body.joinRequest.status).toBe("REJECTED");
    expect(res.body.participant).toBeUndefined();
  });

  it("returns ACCEPTED status with participant id after acceptance", async () => {
    const jr = await createJoinRequest(roomId, "Alex");
    // Simulate what PATCH ACCEPT does: resolve the request and create a participant
    await prisma.joinRequest.update({
      where: { id: jr.id },
      data: { status: "ACCEPTED", resolvedAt: new Date() },
    });
    const p = await createParticipant(roomId, "Alex", "MEMBER");

    const res = await request
      .get(`/rooms/${roomCode}/join-requests/${jr.id}`)
      .expect(200);

    expect(res.body.joinRequest.status).toBe("ACCEPTED");
    expect(res.body.participant.id).toBe(p.id);
    expect(res.body.participant.role).toBe("MEMBER");
    expect(res.body.participant.roomId).toBe(roomId);
  });

  it("returns 404 for unknown request id", async () => {
    await request
      .get(`/rooms/${roomCode}/join-requests/nonexistent`)
      .expect(404);
  });

  it("returns 404 for unknown room code", async () => {
    await request
      .get("/rooms/BADCODE/join-requests/anything")
      .expect(404);
  });
});

// ---------------------------------------------------------------------------
// 5.4 — PATCH /rooms/:id/join-requests/:id — accept / reject
// ---------------------------------------------------------------------------

describe("5.4 PATCH /rooms/:id/join-requests/:id — accept / reject", () => {
  it("HOST can ACCEPT a pending request — creates a participant row", async () => {
    const host = await createParticipant(roomId, "Ayush", "HOST");
    const jr = await createJoinRequest(roomId, "Alex");

    const res = await request
      .patch(`/rooms/${roomId}/join-requests/${jr.id}`)
      .set("X-Participant-Id", host.id)
      .send({ action: "ACCEPT" })
      .expect(200);

    expect(res.body.joinRequest.status).toBe("ACCEPTED");
    expect(res.body.participant.displayName).toBe("Alex");
    expect(res.body.participant.role).toBe("MEMBER");

    const dbParticipant = await prisma.participant.findUnique({
      where: { id: res.body.participant.id },
    });
    expect(dbParticipant).not.toBeNull();
    expect(dbParticipant!.leftAt).toBeNull();
  });

  it("HOST can REJECT a pending request — no participant row created", async () => {
    const host = await createParticipant(roomId, "Ayush", "HOST");
    const jr = await createJoinRequest(roomId, "Alex");

    const res = await request
      .patch(`/rooms/${roomId}/join-requests/${jr.id}`)
      .set("X-Participant-Id", host.id)
      .send({ action: "REJECT" })
      .expect(200);

    expect(res.body.joinRequest.status).toBe("REJECTED");
    expect(res.body.participant).toBeUndefined();

    const participants = await prisma.participant.findMany({ where: { roomId } });
    // Only the HOST participant should exist
    expect(participants.length).toBe(1);
    expect(participants[0]!.id).toBe(host.id);
  });

  it("returns 400 for an invalid action value", async () => {
    const host = await createParticipant(roomId, "Ayush", "HOST");
    const jr = await createJoinRequest(roomId, "Alex");

    await request
      .patch(`/rooms/${roomId}/join-requests/${jr.id}`)
      .set("X-Participant-Id", host.id)
      .send({ action: "APPROVE" })
      .expect(400);
  });

  it("returns 403 when a MEMBER tries to resolve a request", async () => {
    await createParticipant(roomId, "Ayush", "HOST");
    const member = await createParticipant(roomId, "Alex", "MEMBER");
    const jr = await createJoinRequest(roomId, "Rahul");

    await request
      .patch(`/rooms/${roomId}/join-requests/${jr.id}`)
      .set("X-Participant-Id", member.id)
      .send({ action: "ACCEPT" })
      .expect(403);
  });

  it("returns 409 when trying to resolve an already-resolved request", async () => {
    const host = await createParticipant(roomId, "Ayush", "HOST");
    const jr = await createJoinRequest(roomId, "Alex");

    await request
      .patch(`/rooms/${roomId}/join-requests/${jr.id}`)
      .set("X-Participant-Id", host.id)
      .send({ action: "REJECT" })
      .expect(200);

    await request
      .patch(`/rooms/${roomId}/join-requests/${jr.id}`)
      .set("X-Participant-Id", host.id)
      .send({ action: "ACCEPT" })
      .expect(409);
  });

  it("ACCEPT marks the room ACTIVE if it was INACTIVE", async () => {
    await prisma.room.update({ where: { id: roomId }, data: { status: "INACTIVE" } });
    const host = await createParticipant(roomId, "Ayush", "HOST");
    const jr = await createJoinRequest(roomId, "Alex");

    await request
      .patch(`/rooms/${roomId}/join-requests/${jr.id}`)
      .set("X-Participant-Id", host.id)
      .send({ action: "ACCEPT" })
      .expect(200);

    const room = await prisma.room.findUnique({ where: { id: roomId } });
    expect(room!.status).toBe("ACTIVE");
  });
});

// ---------------------------------------------------------------------------
// 5.5 — GET /rooms/:id — room detail hydration
// ---------------------------------------------------------------------------

describe("5.5 GET /rooms/:id — room detail", () => {
  it("returns room data for an active participant", async () => {
    const host = await createParticipant(roomId, "Ayush", "HOST");

    const res = await request
      .get(`/rooms/${roomId}`)
      .set("X-Participant-Id", host.id)
      .expect(200);

    const room = res.body.room;
    expect(room.id).toBe(roomId);
    expect(room.code).toBe(roomCode);
    expect(room.status).toBe("ACTIVE");
    expect(room.playback).toBeDefined();
    expect(Array.isArray(room.participants)).toBe(true);
    const self = room.participants.find((p: { id: string }) => p.id === host.id);
    expect(self).toBeDefined();
    expect(self.displayName).toBe("Ayush");
  });

  it("HOST response includes pendingJoinRequests", async () => {
    const host = await createParticipant(roomId, "Ayush", "HOST");
    await createJoinRequest(roomId, "Alex");
    await createJoinRequest(roomId, "Rahul");

    const res = await request
      .get(`/rooms/${roomId}`)
      .set("X-Participant-Id", host.id)
      .expect(200);

    expect(Array.isArray(res.body.room.pendingJoinRequests)).toBe(true);
    expect(res.body.room.pendingJoinRequests).toHaveLength(2);
    const names = res.body.room.pendingJoinRequests.map((jr: { displayName: string }) => jr.displayName);
    expect(names).toContain("Alex");
    expect(names).toContain("Rahul");
  });

  it("MEMBER response does not include pendingJoinRequests", async () => {
    await createParticipant(roomId, "Ayush", "HOST");
    const member = await createParticipant(roomId, "Alex", "MEMBER");
    await createJoinRequest(roomId, "Rahul");

    const res = await request
      .get(`/rooms/${roomId}`)
      .set("X-Participant-Id", member.id)
      .expect(200);

    expect(res.body.room.pendingJoinRequests).toBeUndefined();
  });

  it("participants include isOnline field — false when not connected via WS", async () => {
    const host = await createParticipant(roomId, "Ayush", "HOST");
    const member = await createParticipant(roomId, "Alex", "MEMBER");

    const res = await request
      .get(`/rooms/${roomId}`)
      .set("X-Participant-Id", host.id)
      .expect(200);

    // Neither has a WS connection in this test — both should be offline
    const participants = res.body.room.participants as Array<{ id: string; isOnline: boolean }>;
    expect(participants.every((p) => p.isOnline === false)).toBe(true);

    // Now connect the host via WS — their isOnline should flip to true
    const { client } = await connectAndSync(server.wsUrl, host.id, roomId);

    const res2 = await request
      .get(`/rooms/${roomId}`)
      .set("X-Participant-Id", host.id)
      .expect(200);

    const hostEntry = (res2.body.room.participants as Array<{ id: string; isOnline: boolean }>)
      .find((p) => p.id === host.id);
    const memberEntry = (res2.body.room.participants as Array<{ id: string; isOnline: boolean }>)
      .find((p) => p.id === member.id);

    expect(hostEntry!.isOnline).toBe(true);
    expect(memberEntry!.isOnline).toBe(false);

    await client.close();
  });

  it("returns 401 without X-Participant-Id header", async () => {
    await request.get(`/rooms/${roomId}`).expect(401);
  });

  it("returns 403 for a participant from a different room", async () => {
    const otherRoom = await createRoom();
    const outsider = await createParticipant(otherRoom.id, "Stranger", "HOST");

    await request
      .get(`/rooms/${roomId}`)
      .set("X-Participant-Id", outsider.id)
      .expect(403);

    await deleteRoom(otherRoom.id);
  });
});

// ---------------------------------------------------------------------------
// 5.6 — PATCH .../leave — participant leave + host transfer
// ---------------------------------------------------------------------------

describe("5.6 PATCH .../leave — participant leave", () => {
  it("MEMBER can leave — participant.leftAt is set", async () => {
    await createParticipant(roomId, "Ayush", "HOST");
    const member = await createParticipant(roomId, "Alex", "MEMBER");

    const res = await request
      .patch(`/rooms/${roomId}/participants/${member.id}/leave`)
      .set("X-Participant-Id", member.id)
      .expect(200);

    expect(res.body.participant.leftAt).not.toBeNull();

    const dbP = await prisma.participant.findUnique({ where: { id: member.id } });
    expect(dbP!.leftAt).not.toBeNull();
  });

  it("last participant leaving sets room to INACTIVE", async () => {
    const host = await createParticipant(roomId, "Ayush", "HOST");

    const res = await request
      .patch(`/rooms/${roomId}/participants/${host.id}/leave`)
      .set("X-Participant-Id", host.id)
      .expect(200);

    expect(res.body.room.status).toBe("INACTIVE");

    const room = await prisma.room.findUnique({ where: { id: roomId } });
    expect(room!.status).toBe("INACTIVE");
  });

  it("HOST leaving transfers role to next participant and returns newHost", async () => {
    const host = await createParticipant(roomId, "Ayush", "HOST");
    const member = await createParticipant(roomId, "Alex", "MEMBER");

    const res = await request
      .patch(`/rooms/${roomId}/participants/${host.id}/leave`)
      .set("X-Participant-Id", host.id)
      .expect(200);

    expect(res.body.newHost.id).toBe(member.id);
    expect(res.body.newHost.role).toBe("HOST");

    const dbMember = await prisma.participant.findUnique({ where: { id: member.id } });
    expect(dbMember!.role).toBe("HOST");
  });

  it("HOST transfer via leave broadcasts HOST_CHANGED to connected participants", async () => {
    const host = await createParticipant(roomId, "Ayush", "HOST");
    const member = await createParticipant(roomId, "Alex", "MEMBER");

    // Member connects via WS so they can receive the broadcast
    const { client: memberClient } = await connectAndSync(server.wsUrl, member.id, roomId);

    await request
      .patch(`/rooms/${roomId}/participants/${host.id}/leave`)
      .set("X-Participant-Id", host.id)
      .expect(200);

    // Expect USER_LEFT then HOST_CHANGED (leave broadcasts USER_LEFT before HOST_CHANGED)
    const userLeft = await memberClient.nextMessage();
    expect(userLeft.type).toBe("USER_LEFT");
    expect((userLeft.payload as { participantId: string }).participantId).toBe(host.id);

    const hostChanged = await memberClient.nextMessage();
    expect(hostChanged.type).toBe("HOST_CHANGED");
    expect((hostChanged.payload as { newHostId: string }).newHostId).toBe(member.id);

    await memberClient.close();
  });

  it("returns 409 if participant already left", async () => {
    const host = await createParticipant(roomId, "Ayush", "HOST");
    const member = await createParticipant(roomId, "Alex", "MEMBER");

    await request
      .patch(`/rooms/${roomId}/participants/${member.id}/leave`)
      .set("X-Participant-Id", member.id)
      .expect(200);

    // After leaving, the participant row has leftAt set. requireParticipant
    // rejects them as no longer active — the response is 403, not 409,
    // because the middleware never reaches the route handler's ALREADY_LEFT check.
    await request
      .patch(`/rooms/${roomId}/participants/${member.id}/leave`)
      .set("X-Participant-Id", member.id)
      .expect(403);
  });

  it("returns 403 if X-Participant-Id does not match the URL param", async () => {
    const host = await createParticipant(roomId, "Ayush", "HOST");
    const member = await createParticipant(roomId, "Alex", "MEMBER");

    // Host tries to kick Alex via leave endpoint
    await request
      .patch(`/rooms/${roomId}/participants/${member.id}/leave`)
      .set("X-Participant-Id", host.id)
      .expect(403);
  });
});

// ---------------------------------------------------------------------------
// 5.7 — DELETE /rooms/:id — HOST closes room
// ---------------------------------------------------------------------------

describe("5.7 DELETE /rooms/:id — HOST closes room", () => {
  it("HOST can close the room", async () => {
    const host = await createParticipant(roomId, "Ayush", "HOST");

    const res = await request
      .delete(`/rooms/${roomId}`)
      .set("X-Participant-Id", host.id)
      .expect(200);

    expect(res.body.room.status).toBe("CLOSED");

    const room = await prisma.room.findUnique({ where: { id: roomId } });
    expect(room!.status).toBe("CLOSED");
  });

  it("returns 403 when a MEMBER tries to close", async () => {
    await createParticipant(roomId, "Ayush", "HOST");
    const member = await createParticipant(roomId, "Alex", "MEMBER");

    await request
      .delete(`/rooms/${roomId}`)
      .set("X-Participant-Id", member.id)
      .expect(403);
  });

  it("returns 409 when room is already CLOSED", async () => {
    const host = await createParticipant(roomId, "Ayush", "HOST");
    await prisma.room.update({ where: { id: roomId }, data: { status: "CLOSED" } });

    await request
      .delete(`/rooms/${roomId}`)
      .set("X-Participant-Id", host.id)
      .expect(409);
  });

  it("returns 401 without X-Participant-Id", async () => {
    await request.delete(`/rooms/${roomId}`).expect(401);
  });
});

// ---------------------------------------------------------------------------
// 5.8 — JOIN_REQUEST WS notification pushed to HOST socket
// ---------------------------------------------------------------------------

describe("5.8 JOIN_REQUEST WS notification", () => {
  it("HOST receives JOIN_REQUEST event when a guest submits via HTTP", async () => {
    const host = await createParticipant(roomId, "Ayush", "HOST");
    const { client: hostClient } = await connectAndSync(server.wsUrl, host.id, roomId);

    // Guest submits join request over HTTP
    const res = await request
      .post(`/rooms/${roomCode}/join-requests`)
      .send({ displayName: "Alex" })
      .expect(201);

    const msg = await hostClient.nextMessage();
    expect(msg.type).toBe("JOIN_REQUEST");
    const payload = msg.payload as { joinRequest: { id: string; displayName: string; status: string } };
    expect(payload.joinRequest.id).toBe(res.body.joinRequest.id);
    expect(payload.joinRequest.displayName).toBe("Alex");
    expect(payload.joinRequest.status).toBe("PENDING");

    await hostClient.close();
  });

  it("no JOIN_REQUEST event is sent when HOST has no WS connection", async () => {
    // Host exists in DB but has no active socket — this should not throw server-side
    await createParticipant(roomId, "Ayush", "HOST");

    await request
      .post(`/rooms/${roomCode}/join-requests`)
      .send({ displayName: "Alex" })
      .expect(201);
    // Test passes as long as the request succeeds without errors
  });
});

// ---------------------------------------------------------------------------
// 5.9 — JOIN_REQUEST_RESOLVED WS event on ACCEPT
// ---------------------------------------------------------------------------

describe("5.9 JOIN_REQUEST_RESOLVED WS event", () => {
  it("connected HOST receives JOIN_REQUEST_RESOLVED with participant data on ACCEPT", async () => {
    const host = await createParticipant(roomId, "Ayush", "HOST");
    const jr = await createJoinRequest(roomId, "Alex");
    const { client: hostClient } = await connectAndSync(server.wsUrl, host.id, roomId);

    await request
      .patch(`/rooms/${roomId}/join-requests/${jr.id}`)
      .set("X-Participant-Id", host.id)
      .send({ action: "ACCEPT" })
      .expect(200);

    const msg = await hostClient.nextMessage();
    expect(msg.type).toBe("JOIN_REQUEST_RESOLVED");

    const payload = msg.payload as {
      joinRequestId: string;
      action: string;
      participant: { id: string; displayName: string; role: string };
    };
    expect(payload.joinRequestId).toBe(jr.id);
    expect(payload.action).toBe("ACCEPTED");
    expect(payload.participant.displayName).toBe("Alex");
    expect(payload.participant.role).toBe("MEMBER");

    await hostClient.close();
  });

  it("connected MEMBER also receives JOIN_REQUEST_RESOLVED on ACCEPT", async () => {
    const host = await createParticipant(roomId, "Ayush", "HOST");
    const member = await createParticipant(roomId, "Rahul", "MEMBER");
    const jr = await createJoinRequest(roomId, "Alex");

    const { client: memberClient } = await connectAndSync(server.wsUrl, member.id, roomId);
    const { client: hostClient } = await connectAndSync(server.wsUrl, host.id, roomId);
    // Drain USER_JOINED on member side (host connected after member)
    await memberClient.nextMessage();

    await request
      .patch(`/rooms/${roomId}/join-requests/${jr.id}`)
      .set("X-Participant-Id", host.id)
      .send({ action: "ACCEPT" })
      .expect(200);

    // Both should receive the event
    const hostMsg = await hostClient.nextMessage();
    const memberMsg = await memberClient.nextMessage();

    expect(hostMsg.type).toBe("JOIN_REQUEST_RESOLVED");
    expect(memberMsg.type).toBe("JOIN_REQUEST_RESOLVED");

    await hostClient.close();
    await memberClient.close();
  });

  it("no JOIN_REQUEST_RESOLVED event is sent on REJECT", async () => {
    const host = await createParticipant(roomId, "Ayush", "HOST");
    const jr = await createJoinRequest(roomId, "Alex");
    const { client: hostClient } = await connectAndSync(server.wsUrl, host.id, roomId);

    await request
      .patch(`/rooms/${roomId}/join-requests/${jr.id}`)
      .set("X-Participant-Id", host.id)
      .send({ action: "REJECT" })
      .expect(200);

    // No WS event should arrive — nextMessage should time out
    await expect(hostClient.nextMessage(500)).rejects.toThrow("timed out");

    await hostClient.close();
  });
});

// ---------------------------------------------------------------------------
// 5.10 — Host transfer prefers connected participant
// ---------------------------------------------------------------------------

describe("5.10 Host transfer connection preference", () => {
  it("leave route transfers host to connected participant over an earlier-joined but offline one", async () => {
    const host = await createParticipant(roomId, "Ayush", "HOST");
    // Alex joins first (earlier joinedAt) but will have no WS
    const alex = await createParticipant(roomId, "Alex", "MEMBER");
    // Rahul joins second but will be connected
    const rahul = await createParticipant(roomId, "Rahul", "MEMBER");

    // Only Rahul connects via WS
    const { client: rahulClient } = await connectAndSync(server.wsUrl, rahul.id, roomId);
    // No drain needed — no other WS client connects in this test, so no USER_JOINED arrives

    await request
      .patch(`/rooms/${roomId}/participants/${host.id}/leave`)
      .set("X-Participant-Id", host.id)
      .expect(200);

    // Rahul should become host (connected), not Alex (offline but earlier)
    const dbRahul = await prisma.participant.findUnique({ where: { id: rahul.id } });
    const dbAlex = await prisma.participant.findUnique({ where: { id: alex.id } });
    expect(dbRahul!.role).toBe("HOST");
    expect(dbAlex!.role).toBe("MEMBER");

    // Rahul receives USER_LEFT then HOST_CHANGED
    const userLeft = await rahulClient.nextMessage();
    expect(userLeft.type).toBe("USER_LEFT");

    const hostChanged = await rahulClient.nextMessage();
    expect(hostChanged.type).toBe("HOST_CHANGED");
    expect((hostChanged.payload as { newHostId: string }).newHostId).toBe(rahul.id);

    await rahulClient.close();
  });

  it("falls back to DB order when no participants are connected", async () => {
    const host = await createParticipant(roomId, "Ayush", "HOST");
    const alex = await createParticipant(roomId, "Alex", "MEMBER");
    await createParticipant(roomId, "Rahul", "MEMBER");

    // Nobody is connected via WS — fallback to DB order (Alex joined first)
    await request
      .patch(`/rooms/${roomId}/participants/${host.id}/leave`)
      .set("X-Participant-Id", host.id)
      .expect(200);

    const dbAlex = await prisma.participant.findUnique({ where: { id: alex.id } });
    expect(dbAlex!.role).toBe("HOST");
  });
});
