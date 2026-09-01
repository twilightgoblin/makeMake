// -----------------------------------------------------------------------------
// Makemake — WS connection handler
//
// Called once per new WebSocket connection.
//
// Handshake protocol:
//   Client connects to ws://host/ws?participantId=<id>&roomId=<id>
//   Server:
//     1. Validates query params exist
//     2. Looks up participant in DB (must exist, must belong to room, must be active)
//     3. Registers connection in the manager
//     4. Sends ROOM_STATE to the new socket
//     5. Broadcasts USER_JOINED to the rest of the room
//
// The socket's 'message' and 'close' events are also wired here.
// -----------------------------------------------------------------------------

import type WebSocket from "ws";
import type { IncomingMessage } from "http";
import { URL } from "url";
import { prisma } from "../../lib/prisma.js";
import {
  makeServerEvent,
  makeErrorEvent,
  type ClientEnvelope,
  type RoomStatePayload,
  type UserJoinedPayload,
} from "../../lib/wsTypes.js";
import {
  addConnection,
  sendTo,
  clearPendingTransfer,
  hasPendingTransfer,
} from "../connectionManager.js";
import { publishRoomEvent } from "../../lib/roomEvents.js";
import { handleMessage } from "./message.js";
import { handleDisconnect } from "./disconnect.js";

export async function handleConnection(
  socket: WebSocket,
  req: IncomingMessage,
): Promise<void> {
  // -------------------------------------------------------------------------
  // 1. Parse query params
  // -------------------------------------------------------------------------
  const rawUrl = req.url ?? "";
  // req.url is just the path+query; we need an absolute URL to parse it.
  const url = new URL(rawUrl, "ws://localhost");

  const participantId = url.searchParams.get("participantId");
  const roomId = url.searchParams.get("roomId");

  if (!participantId || !roomId) {
    sendTo(socket, makeErrorEvent("MISSING_PARTICIPANT", "participantId and roomId are required query parameters."));
    socket.close(1008, "Missing participantId or roomId");
    return;
  }

  // -------------------------------------------------------------------------
  // 2. Validate participant in DB
  // -------------------------------------------------------------------------
  const participant = await prisma.participant.findFirst({
    where: { id: participantId, roomId, leftAt: null },
  });

  if (!participant) {
    sendTo(socket, makeErrorEvent("PARTICIPANT_NOT_ACTIVE", "Participant not found or no longer active in this room."));
    socket.close(1008, "Participant not active");
    return;
  }

  // -------------------------------------------------------------------------
  // 3. Validate room
  // -------------------------------------------------------------------------
  const room = await prisma.room.findUnique({
    where: { id: roomId },
    include: {
      currentSong: {
        select: { id: true, title: true, artist: true, album: true, duration: true, coverUrl: true, audioUrl: true },
      },
      participants: {
        where: { leftAt: null },
        select: { id: true, displayName: true, role: true },
        orderBy: { joinedAt: "asc" },
      },
    },
  });

  if (!room) {
    sendTo(socket, makeErrorEvent("ROOM_NOT_FOUND", "Room not found."));
    socket.close(1008, "Room not found");
    return;
  }

  if (room.status === "CLOSED") {
    sendTo(socket, makeErrorEvent("ROOM_CLOSED", "This room has been closed."));
    socket.close(1008, "Room closed");
    return;
  }

  // -------------------------------------------------------------------------
  // 4. Register connection
  //
  // If a pending host-transfer timer exists for this participant (they
  // disconnected recently but are reconnecting within the grace window),
  // cancel it so they keep their HOST role. No DB update is needed because
  // the deferred doHostTransfer() hasn't run yet — the DB role is unchanged.
  // -------------------------------------------------------------------------
  if (hasPendingTransfer(participantId)) {
    clearPendingTransfer(participantId);
    // Ensure the in-memory record reflects their DB role (still HOST).
    // participant.role comes from the DB read above, which hasn't been
    // touched by the grace-period path, so it's still correct.
  }

  addConnection({
    socket,
    roomId,
    participantId,
    displayName: participant.displayName,
    role: participant.role as "HOST" | "MEMBER",
  });

  // -------------------------------------------------------------------------
  // 5. Send ROOM_STATE to the newly connected client
  // -------------------------------------------------------------------------
  const roomStatePayload: RoomStatePayload = {
    roomId: room.id,
    status: room.status as "ACTIVE" | "INACTIVE" | "CLOSED",
    playback: {
      currentSong: room.currentSong
        ? {
            id: room.currentSong.id,
            title: room.currentSong.title,
            artist: room.currentSong.artist,
            album: room.currentSong.album,
            duration: room.currentSong.duration,
            coverUrl: room.currentSong.coverUrl,
            audioUrl: room.currentSong.audioUrl,
          }
        : null,
      isPlaying: room.isPlaying,
      positionSecs: room.positionSecs,
      stateUpdatedAt: room.stateUpdatedAt?.toISOString() ?? null,
    },
    participants: room.participants.map((p) => ({
      id: p.id,
      displayName: p.displayName,
      role: p.role as "HOST" | "MEMBER",
    })),
  };

  sendTo(socket, makeServerEvent("ROOM_STATE", roomStatePayload));

  // -------------------------------------------------------------------------
  // 6. Broadcast USER_JOINED to everyone else in the room
  // -------------------------------------------------------------------------
  const userJoinedPayload: UserJoinedPayload = {
    participant: {
      id: participant.id,
      displayName: participant.displayName,
      role: participant.role as "HOST" | "MEMBER",
    },
  };

  await publishRoomEvent(roomId, makeServerEvent("USER_JOINED", userJoinedPayload), participantId);

  // -------------------------------------------------------------------------
  // 7. Wire message + close handlers
  // -------------------------------------------------------------------------
  socket.on("message", (raw) => {
    void handleMessage(socket, participantId, roomId, raw);
  });

  socket.on("close", () => {
    void handleDisconnect(participantId);
  });

  socket.on("error", (err) => {
    console.error(`[ws] socket error participant=${participantId}`, err);
  });
}
