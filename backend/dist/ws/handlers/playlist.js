"use strict";
// -----------------------------------------------------------------------------
// Makemake — WS playlist handler
//
// Handles: PLAYLIST_ADD, PLAYLIST_REMOVE, PLAYLIST_REORDER
//
// All participants (HOST and MEMBER) can modify the playlist.
// The DB transaction logic mirrors the HTTP playlist routes exactly.
// After each mutation the full updated order is broadcast so all clients
// stay in sync without needing to refetch.
// -----------------------------------------------------------------------------
Object.defineProperty(exports, "__esModule", { value: true });
exports.handlePlaylist = handlePlaylist;
const prisma_js_1 = require("../../lib/prisma.js");
const wsTypes_js_1 = require("../../lib/wsTypes.js");
const connectionManager_js_1 = require("../connectionManager.js");
const rateLimit_js_1 = require("../rateLimit.js");
const roomEvents_js_1 = require("../../lib/roomEvents.js");
async function handlePlaylist(socket, participantId, roomId, envelope) {
    // Rate limit: 30 playlist operations per minute per participant
    const key = `rate-limit:playlist:${participantId}`;
    if (!(await (0, rateLimit_js_1.wsRateLimit)(socket, key, 30, 60 * 1000))) {
        return;
    }
    switch (envelope.type) {
        case "PLAYLIST_ADD":
            await handleAdd(socket, participantId, roomId, envelope);
            break;
        case "PLAYLIST_REMOVE":
            await handleRemove(socket, roomId, envelope);
            break;
        case "PLAYLIST_REORDER":
            await handleReorder(socket, roomId, envelope);
            break;
    }
}
// ---------------------------------------------------------------------------
// PLAYLIST_ADD
// ---------------------------------------------------------------------------
async function handleAdd(socket, participantId, roomId, envelope) {
    const payload = envelope.payload;
    if (!payload?.songId || typeof payload.songId !== "string") {
        (0, connectionManager_js_1.sendTo)(socket, (0, wsTypes_js_1.makeErrorEvent)("INVALID_PAYLOAD", '"songId" is required.', envelope.requestId));
        return;
    }
    const song = await prisma_js_1.prisma.song.findUnique({ where: { id: payload.songId } });
    if (!song) {
        (0, connectionManager_js_1.sendTo)(socket, (0, wsTypes_js_1.makeErrorEvent)("SONG_NOT_FOUND", "Song not found in the library.", envelope.requestId));
        return;
    }
    // Append at the end
    const last = await prisma_js_1.prisma.playlistEntry.findFirst({
        where: { roomId },
        orderBy: { position: "desc" },
        select: { position: true },
    });
    const nextPosition = last !== null ? last.position + 1 : 0;
    const entry = await prisma_js_1.prisma.playlistEntry.create({
        data: { roomId, songId: payload.songId, position: nextPosition, addedById: participantId },
        select: {
            id: true,
            position: true,
            addedById: true,
            addedAt: true,
            song: {
                select: { id: true, title: true, artist: true, album: true, duration: true, coverUrl: true, audioUrl: true },
            },
        },
    });
    const broadcast = {
        entry: {
            id: entry.id,
            position: entry.position,
            addedById: entry.addedById,
            addedAt: entry.addedAt.toISOString(),
            song: entry.song,
        },
    };
    await (0, roomEvents_js_1.publishRoomEvent)(roomId, (0, wsTypes_js_1.makeServerEvent)("PLAYLIST_ADD", broadcast));
    // If the room has no current song, set this as the first one (paused at 0).
    // This is the only path that populates currentSongId for a fresh room.
    const room = await prisma_js_1.prisma.room.findUnique({
        where: { id: roomId },
        select: { currentSongId: true },
    });
    if (!room?.currentSongId) {
        const now = new Date();
        await prisma_js_1.prisma.room.update({
            where: { id: roomId },
            data: { currentSongId: entry.song.id, positionSecs: 0, isPlaying: false, stateUpdatedAt: now },
        });
        // Broadcast a NEXT-style event so all clients load the song (paused).
        await (0, roomEvents_js_1.publishRoomEvent)(roomId, (0, wsTypes_js_1.makeServerEvent)("NEXT", {
            songId: entry.song.id,
            positionSecs: 0,
            isPlaying: false,
            stateUpdatedAt: now.toISOString(),
        }));
    }
}
// ---------------------------------------------------------------------------
// PLAYLIST_REMOVE
// ---------------------------------------------------------------------------
async function handleRemove(socket, roomId, envelope) {
    const payload = envelope.payload;
    if (!payload?.entryId || typeof payload.entryId !== "string") {
        (0, connectionManager_js_1.sendTo)(socket, (0, wsTypes_js_1.makeErrorEvent)("INVALID_PAYLOAD", '"entryId" is required.', envelope.requestId));
        return;
    }
    const entry = await prisma_js_1.prisma.playlistEntry.findFirst({
        where: { id: payload.entryId, roomId },
    });
    if (!entry) {
        (0, connectionManager_js_1.sendTo)(socket, (0, wsTypes_js_1.makeErrorEvent)("PLAYLIST_ENTRY_NOT_FOUND", "Playlist entry not found.", envelope.requestId));
        return;
    }
    await prisma_js_1.prisma.$transaction(async (tx) => {
        await tx.playlistEntry.delete({ where: { id: payload.entryId } });
        await tx.$executeRaw `
      UPDATE playlist_entries
      SET position = position - 1
      WHERE "roomId" = ${roomId}
        AND position > ${entry.position}
    `;
    });
    // Fetch updated order to broadcast
    const updatedPlaylist = await prisma_js_1.prisma.playlistEntry.findMany({
        where: { roomId },
        orderBy: { position: "asc" },
        select: { id: true, position: true },
    });
    const broadcast = {
        entryId: payload.entryId,
        playlist: updatedPlaylist,
    };
    await (0, roomEvents_js_1.publishRoomEvent)(roomId, (0, wsTypes_js_1.makeServerEvent)("PLAYLIST_REMOVE", broadcast));
}
// ---------------------------------------------------------------------------
// PLAYLIST_REORDER
// ---------------------------------------------------------------------------
async function handleReorder(socket, roomId, envelope) {
    const payload = envelope.payload;
    if (!payload?.entryId || typeof payload.entryId !== "string") {
        (0, connectionManager_js_1.sendTo)(socket, (0, wsTypes_js_1.makeErrorEvent)("INVALID_PAYLOAD", '"entryId" is required.', envelope.requestId));
        return;
    }
    if (typeof payload?.newPosition !== "number" || !Number.isInteger(payload.newPosition) || payload.newPosition < 0) {
        (0, connectionManager_js_1.sendTo)(socket, (0, wsTypes_js_1.makeErrorEvent)("INVALID_PAYLOAD", '"newPosition" must be a non-negative integer.', envelope.requestId));
        return;
    }
    const entry = await prisma_js_1.prisma.playlistEntry.findFirst({
        where: { id: payload.entryId, roomId },
    });
    if (!entry) {
        (0, connectionManager_js_1.sendTo)(socket, (0, wsTypes_js_1.makeErrorEvent)("PLAYLIST_ENTRY_NOT_FOUND", "Playlist entry not found.", envelope.requestId));
        return;
    }
    if (entry.position === payload.newPosition) {
        // No-op — already in the right place. Still broadcast current state.
        const current = await prisma_js_1.prisma.playlistEntry.findMany({
            where: { roomId },
            orderBy: { position: "asc" },
            select: { id: true, position: true },
        });
        const broadcast = { entryId: payload.entryId, playlist: current };
        await (0, roomEvents_js_1.publishRoomEvent)(roomId, (0, wsTypes_js_1.makeServerEvent)("PLAYLIST_REORDER", broadcast));
        return;
    }
    const playlistSize = await prisma_js_1.prisma.playlistEntry.count({ where: { roomId } });
    if (payload.newPosition > playlistSize - 1) {
        (0, connectionManager_js_1.sendTo)(socket, (0, wsTypes_js_1.makeErrorEvent)("INVALID_PAYLOAD", `newPosition must be between 0 and ${playlistSize - 1}.`, envelope.requestId));
        return;
    }
    // Same sentinel-based transaction as the HTTP route
    await prisma_js_1.prisma.$transaction(async (tx) => {
        const from = entry.position;
        const to = payload.newPosition;
        // Park at -1 to vacate slot without triggering unique constraint
        await tx.$executeRaw `UPDATE playlist_entries SET position = -1 WHERE id = ${payload.entryId}`;
        if (from < to) {
            await tx.$executeRaw `
        UPDATE playlist_entries
        SET position = position - 1
        WHERE "roomId" = ${roomId}
          AND position > ${from}
          AND position <= ${to}
      `;
        }
        else {
            await tx.$executeRaw `
        UPDATE playlist_entries
        SET position = position + 1
        WHERE "roomId" = ${roomId}
          AND position >= ${to}
          AND position < ${from}
      `;
        }
        await tx.$executeRaw `UPDATE playlist_entries SET position = ${to} WHERE id = ${payload.entryId}`;
    });
    const updatedPlaylist = await prisma_js_1.prisma.playlistEntry.findMany({
        where: { roomId },
        orderBy: { position: "asc" },
        select: { id: true, position: true },
    });
    const broadcast = {
        entryId: payload.entryId,
        playlist: updatedPlaylist,
    };
    await (0, roomEvents_js_1.publishRoomEvent)(roomId, (0, wsTypes_js_1.makeServerEvent)("PLAYLIST_REORDER", broadcast));
}
//# sourceMappingURL=playlist.js.map