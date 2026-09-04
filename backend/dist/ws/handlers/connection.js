"use strict";
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
//
// Server-side ping (Phase 8.3):
//   The server sends a WS ping frame every WS_PING_INTERVAL_MS (default 15s).
//   If no pong is received within WS_PING_TIMEOUT_MS (default 5s), the socket
//   is forcibly terminated. This makes dead connections (e.g. instance crash,
//   network partition) detectable in ~20s rather than waiting for the OS TCP
//   keepalive timeout (minutes).
// -----------------------------------------------------------------------------
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleConnection = handleConnection;
const url_1 = require("url");
const prisma_js_1 = require("../../lib/prisma.js");
const wsTypes_js_1 = require("../../lib/wsTypes.js");
const connectionManager_js_1 = require("../connectionManager.js");
const roomEvents_js_1 = require("../../lib/roomEvents.js");
const presence_js_1 = require("../../lib/presence.js");
const serverId_js_1 = require("../../lib/serverId.js");
const hostGrace_js_1 = require("../../lib/hostGrace.js");
const message_js_1 = require("./message.js");
const disconnect_js_1 = require("./disconnect.js");
// ---------------------------------------------------------------------------
// Ping / pong configuration
//   WS_PING_INTERVAL_MS  — how often to send a ping (default 15s)
//   WS_PING_TIMEOUT_MS   — how long to wait for a pong reply (default 5s)
//
// Dead connection detection window = INTERVAL + TIMEOUT (default 20s).
// ---------------------------------------------------------------------------
function getPingIntervalMs() {
    return Number(process.env["WS_PING_INTERVAL_MS"] ?? 15000);
}
function getPingTimeoutMs() {
    return Number(process.env["WS_PING_TIMEOUT_MS"] ?? 5000);
}
async function handleConnection(socket, req) {
    // -------------------------------------------------------------------------
    // 1. Parse query params
    // -------------------------------------------------------------------------
    const rawUrl = req.url ?? "";
    // req.url is just the path+query; we need an absolute URL to parse it.
    const url = new url_1.URL(rawUrl, "ws://localhost");
    const participantId = url.searchParams.get("participantId");
    const roomId = url.searchParams.get("roomId");
    if (!participantId || !roomId) {
        (0, connectionManager_js_1.sendTo)(socket, (0, wsTypes_js_1.makeErrorEvent)("MISSING_PARTICIPANT", "participantId and roomId are required query parameters."));
        socket.close(1008, "Missing participantId or roomId");
        return;
    }
    // -------------------------------------------------------------------------
    // 2. Validate participant in DB
    // -------------------------------------------------------------------------
    const participant = await prisma_js_1.prisma.participant.findFirst({
        where: { id: participantId, roomId, leftAt: null },
    });
    if (!participant) {
        (0, connectionManager_js_1.sendTo)(socket, (0, wsTypes_js_1.makeErrorEvent)("PARTICIPANT_NOT_ACTIVE", "Participant not found or no longer active in this room."));
        socket.close(1008, "Participant not active");
        return;
    }
    // -------------------------------------------------------------------------
    // 3. Validate room
    // -------------------------------------------------------------------------
    const room = await prisma_js_1.prisma.room.findUnique({
        where: { id: roomId },
        include: {
            currentSong: {
                select: { id: true, provider: true, externalId: true, title: true, artist: true, album: true, duration: true, coverUrl: true },
            },
            participants: {
                where: { leftAt: null },
                select: { id: true, displayName: true, role: true },
                orderBy: { joinedAt: "asc" },
            },
        },
    });
    if (!room) {
        (0, connectionManager_js_1.sendTo)(socket, (0, wsTypes_js_1.makeErrorEvent)("ROOM_NOT_FOUND", "Room not found."));
        socket.close(1008, "Room not found");
        return;
    }
    if (room.status === "CLOSED") {
        (0, connectionManager_js_1.sendTo)(socket, (0, wsTypes_js_1.makeErrorEvent)("ROOM_CLOSED", "This room has been closed."));
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
    //
    // cancelHostGrace() is always called for HOST participants — it is a no-op
    // if no grace key exists, and it works across instances (Redis-backed).
    // clearPendingTransfer() cancels the in-process setTimeout if this is the
    // same instance the HOST disconnected from.
    // -------------------------------------------------------------------------
    if (participant.role === "HOST") {
        // Cancel the cross-instance Redis grace key first so doHostTransfer()
        // on any instance sees the key is gone and aborts.
        await (0, hostGrace_js_1.cancelHostGrace)(participantId);
    }
    if ((0, connectionManager_js_1.hasPendingTransfer)(participantId)) {
        (0, connectionManager_js_1.clearPendingTransfer)(participantId);
        // Ensure the in-memory record reflects their DB role (still HOST).
        // participant.role comes from the DB read above, which hasn't been
        // touched by the grace-period path, so it's still correct.
    }
    (0, connectionManager_js_1.addConnection)({
        socket,
        roomId,
        participantId,
        displayName: participant.displayName,
        role: participant.role,
    });
    // -------------------------------------------------------------------------
    // 4b. Register distributed presence in Redis and start heartbeat + ping
    // -------------------------------------------------------------------------
    await (0, presence_js_1.registerPresence)(participantId, roomId, serverId_js_1.SERVER_ID);
    const aug = socket;
    // Presence heartbeat — refreshes the Redis TTL so an active connection
    // is never evicted by the presence TTL.
    aug._heartbeat = setInterval(() => {
        void (0, presence_js_1.refreshPresence)(participantId);
    }, presence_js_1.HEARTBEAT_INTERVAL_MS);
    // WS ping — sends a ping frame on an interval. If no pong comes back
    // within WS_PING_TIMEOUT_MS, the socket is dead and we terminate it.
    // The 'close' event will then fire normally and handleDisconnect runs.
    aug._ping = setInterval(() => {
        if (aug.readyState !== aug.OPEN)
            return;
        // Arm the pong deadline timer. It will terminate the socket if pong
        // doesn't arrive in time.
        aug._pongTimer = setTimeout(() => {
            console.warn(`[ws] pong timeout participant=${participantId} — terminating dead socket`);
            aug.terminate(); // forcibly close — fires 'close' event
        }, getPingTimeoutMs());
        aug.ping();
    }, getPingIntervalMs());
    // Cancel the pong deadline when the pong arrives.
    aug.on("pong", () => {
        if (aug._pongTimer !== undefined) {
            clearTimeout(aug._pongTimer);
            aug._pongTimer = undefined;
        }
    });
    // -------------------------------------------------------------------------
    // 5. Send ROOM_STATE to the newly connected client
    // -------------------------------------------------------------------------
    const roomStatePayload = {
        roomId: room.id,
        status: room.status,
        playback: {
            currentSong: room.currentSong
                ? {
                    id: room.currentSong.id,
                    provider: room.currentSong.provider,
                    externalId: room.currentSong.externalId,
                    title: room.currentSong.title,
                    artist: room.currentSong.artist,
                    album: room.currentSong.album,
                    duration: room.currentSong.duration,
                    coverUrl: room.currentSong.coverUrl,
                }
                : null,
            isPlaying: room.isPlaying,
            positionSecs: room.positionSecs,
            stateUpdatedAt: room.stateUpdatedAt?.toISOString() ?? null,
        },
        participants: room.participants.map((p) => ({
            id: p.id,
            displayName: p.displayName,
            role: p.role,
        })),
    };
    (0, connectionManager_js_1.sendTo)(socket, (0, wsTypes_js_1.makeServerEvent)("ROOM_STATE", roomStatePayload));
    // -------------------------------------------------------------------------
    // 6. Broadcast USER_JOINED to everyone else in the room
    // -------------------------------------------------------------------------
    const userJoinedPayload = {
        participant: {
            id: participant.id,
            displayName: participant.displayName,
            role: participant.role,
        },
    };
    await (0, roomEvents_js_1.publishRoomEvent)(roomId, (0, wsTypes_js_1.makeServerEvent)("USER_JOINED", userJoinedPayload), participantId);
    // -------------------------------------------------------------------------
    // 7. Wire message + close handlers
    // -------------------------------------------------------------------------
    socket.on("message", (raw) => {
        void (0, message_js_1.handleMessage)(socket, participantId, roomId, raw);
    });
    socket.on("close", () => {
        void (0, disconnect_js_1.handleDisconnect)(participantId, socket);
    });
    socket.on("error", (err) => {
        console.error(`[ws] socket error participant=${participantId}`, err);
    });
}
//# sourceMappingURL=connection.js.map