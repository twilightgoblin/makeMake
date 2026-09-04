"use strict";
// -----------------------------------------------------------------------------
// Makemake — WS playback handler
//
// Handles: PLAY, PAUSE, SEEK, NEXT, PREVIOUS
//
// All playback events are HOST-only.
// Each handler:
//   1. Verifies caller is HOST
//   2. Validates payload
//   3. Updates Room row in DB (isPlaying, positionSecs, stateUpdatedAt,
//      currentSongId for NEXT/PREVIOUS)
//   4. Broadcasts the event to the entire room (including the caller)
// -----------------------------------------------------------------------------
Object.defineProperty(exports, "__esModule", { value: true });
exports.handlePlayback = handlePlayback;
const prisma_js_1 = require("../../lib/prisma.js");
const wsTypes_js_1 = require("../../lib/wsTypes.js");
const connectionManager_js_1 = require("../connectionManager.js");
const roomEvents_js_1 = require("../../lib/roomEvents.js");
async function handlePlayback(socket, participantId, roomId, envelope) {
    // -------------------------------------------------------------------------
    // HOST-only guard
    // -------------------------------------------------------------------------
    const connection = (0, connectionManager_js_1.getConnection)(participantId);
    if (!connection || connection.role !== "HOST") {
        (0, connectionManager_js_1.sendTo)(socket, (0, wsTypes_js_1.makeErrorEvent)("HOST_ONLY", "Only the room host can control playback.", envelope.requestId));
        return;
    }
    // -------------------------------------------------------------------------
    // Route to the specific event handler
    // -------------------------------------------------------------------------
    switch (envelope.type) {
        case "PLAY":
            await handlePlay(roomId, envelope);
            break;
        case "PAUSE":
            await handlePause(roomId, envelope);
            break;
        case "SEEK":
            await handleSeek(socket, roomId, envelope);
            break;
        case "NEXT":
            await handleNext(roomId, envelope);
            break;
        case "PREVIOUS":
            await handlePrevious(roomId, envelope);
            break;
        case "SET_SONG":
            await handleSetSong(socket, roomId, envelope);
            break;
    }
}
// ---------------------------------------------------------------------------
// PLAY
// ---------------------------------------------------------------------------
async function handlePlay(roomId, envelope) {
    const payload = envelope.payload;
    const positionSecs = typeof payload?.positionSecs === "number" ? payload.positionSecs : 0;
    const now = new Date();
    const updated = await prisma_js_1.prisma.room.update({
        where: { id: roomId },
        data: { isPlaying: true, positionSecs, stateUpdatedAt: now },
        select: { currentSongId: true },
    });
    const broadcast = {
        songId: updated.currentSongId,
        positionSecs,
        stateUpdatedAt: now.toISOString(),
    };
    await (0, roomEvents_js_1.publishRoomEvent)(roomId, (0, wsTypes_js_1.makeServerEvent)("PLAY", broadcast));
}
// ---------------------------------------------------------------------------
// PAUSE
// ---------------------------------------------------------------------------
async function handlePause(roomId, envelope) {
    const payload = envelope.payload;
    const positionSecs = typeof payload?.positionSecs === "number" ? payload.positionSecs : 0;
    const now = new Date();
    const updated = await prisma_js_1.prisma.room.update({
        where: { id: roomId },
        data: { isPlaying: false, positionSecs, stateUpdatedAt: now },
        select: { currentSongId: true },
    });
    const broadcast = {
        songId: updated.currentSongId,
        positionSecs,
        stateUpdatedAt: now.toISOString(),
    };
    await (0, roomEvents_js_1.publishRoomEvent)(roomId, (0, wsTypes_js_1.makeServerEvent)("PAUSE", broadcast));
}
// ---------------------------------------------------------------------------
// SEEK
// ---------------------------------------------------------------------------
async function handleSeek(socket, roomId, envelope) {
    const payload = envelope.payload;
    if (typeof payload?.positionSecs !== "number" || payload.positionSecs < 0) {
        (0, connectionManager_js_1.sendTo)(socket, (0, wsTypes_js_1.makeErrorEvent)("INVALID_PAYLOAD", "positionSecs must be a non-negative number.", envelope.requestId));
        return;
    }
    // Validate against song duration
    const room = await prisma_js_1.prisma.room.findUnique({
        where: { id: roomId },
        select: { currentSongId: true, currentSong: { select: { duration: true } } },
    });
    if (room?.currentSong && payload.positionSecs > room.currentSong.duration) {
        (0, connectionManager_js_1.sendTo)(socket, (0, wsTypes_js_1.makeErrorEvent)("SEEK_OUT_OF_RANGE", `positionSecs ${payload.positionSecs} exceeds song duration ${room.currentSong.duration}.`, envelope.requestId));
        return;
    }
    const now = new Date();
    await prisma_js_1.prisma.room.update({
        where: { id: roomId },
        data: { positionSecs: payload.positionSecs, stateUpdatedAt: now },
    });
    const broadcast = {
        songId: room?.currentSongId ?? null,
        positionSecs: payload.positionSecs,
        stateUpdatedAt: now.toISOString(),
    };
    await (0, roomEvents_js_1.publishRoomEvent)(roomId, (0, wsTypes_js_1.makeServerEvent)("SEEK", broadcast));
}
// ---------------------------------------------------------------------------
// NEXT
// ---------------------------------------------------------------------------
async function handleNext(roomId, envelope) {
    await changeSong(roomId, envelope, "next");
}
// ---------------------------------------------------------------------------
// PREVIOUS
// ---------------------------------------------------------------------------
async function handlePrevious(roomId, envelope) {
    await changeSong(roomId, envelope, "previous");
}
// ---------------------------------------------------------------------------
// Shared song-change logic for NEXT / PREVIOUS
// ---------------------------------------------------------------------------
async function changeSong(roomId, envelope, direction) {
    const room = await prisma_js_1.prisma.room.findUnique({
        where: { id: roomId },
        select: { currentSongId: true, isPlaying: true, playlist: { orderBy: { position: "asc" }, select: { id: true, position: true, songId: true } } },
    });
    if (!room)
        return;
    const playlist = room.playlist;
    if (playlist.length === 0)
        return;
    // Find the current entry index
    const currentIdx = playlist.findIndex((e) => e.songId === room.currentSongId);
    let targetIdx;
    if (direction === "next") {
        targetIdx = currentIdx >= 0 && currentIdx < playlist.length - 1 ? currentIdx + 1 : 0;
    }
    else {
        targetIdx = currentIdx > 0 ? currentIdx - 1 : playlist.length - 1;
    }
    const targetEntry = playlist[targetIdx];
    if (!targetEntry)
        return;
    const now = new Date();
    await prisma_js_1.prisma.room.update({
        where: { id: roomId },
        data: {
            currentSongId: targetEntry.songId,
            positionSecs: 0,
            // Preserve the playing/paused state the room was already in
            isPlaying: room.isPlaying,
            stateUpdatedAt: now,
        },
    });
    const broadcast = {
        songId: targetEntry.songId,
        positionSecs: 0,
        isPlaying: room.isPlaying,
        stateUpdatedAt: now.toISOString(),
    };
    const eventType = direction === "next" ? "NEXT" : "PREVIOUS";
    await (0, roomEvents_js_1.publishRoomEvent)(roomId, (0, wsTypes_js_1.makeServerEvent)(eventType, broadcast));
}
// ---------------------------------------------------------------------------
// SET_SONG — HOST jumps directly to a specific playlist entry
// Pauses playback, sets currentSongId to the entry's song, resets position.
// Broadcasts as a NEXT-style SongChangeBroadcastPayload so clients reload audio.
// ---------------------------------------------------------------------------
async function handleSetSong(socket, roomId, envelope) {
    const payload = envelope.payload;
    if (!payload?.entryId || typeof payload.entryId !== "string") {
        (0, connectionManager_js_1.sendTo)(socket, (0, wsTypes_js_1.makeErrorEvent)("INVALID_PAYLOAD", '"entryId" is required.', envelope.requestId));
        return;
    }
    const entry = await prisma_js_1.prisma.playlistEntry.findFirst({
        where: { id: payload.entryId, roomId },
        select: { songId: true },
    });
    if (!entry) {
        (0, connectionManager_js_1.sendTo)(socket, (0, wsTypes_js_1.makeErrorEvent)("PLAYLIST_ENTRY_NOT_FOUND", "Playlist entry not found.", envelope.requestId));
        return;
    }
    const now = new Date();
    const isPlaying = payload.play === true;
    const updated = await prisma_js_1.prisma.room.update({
        where: { id: roomId },
        data: {
            currentSongId: entry.songId,
            positionSecs: 0,
            isPlaying,
            stateUpdatedAt: now,
        },
        select: { isPlaying: true },
    });
    const broadcast = {
        songId: entry.songId,
        positionSecs: 0,
        isPlaying,
        stateUpdatedAt: now.toISOString(),
    };
    // Reuse NEXT event type on the wire — same payload shape, clients handle it identically.
    await (0, roomEvents_js_1.publishRoomEvent)(roomId, (0, wsTypes_js_1.makeServerEvent)("NEXT", broadcast));
    void updated;
}
//# sourceMappingURL=playback.js.map