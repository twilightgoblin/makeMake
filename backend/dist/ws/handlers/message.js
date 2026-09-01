"use strict";
// -----------------------------------------------------------------------------
// Makemake — WS message dispatcher
//
// Parses every raw message from a client socket, validates the envelope shape,
// and routes to the appropriate domain handler.
// All handler errors are caught here and sent back as ERROR events.
// -----------------------------------------------------------------------------
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleMessage = handleMessage;
const wsTypes_js_1 = require("../../lib/wsTypes.js");
const connectionManager_js_1 = require("../connectionManager.js");
const playback_js_1 = require("./playback.js");
const playlist_js_1 = require("./playlist.js");
const chat_js_1 = require("./chat.js");
const PLAYBACK_EVENTS = new Set(["PLAY", "PAUSE", "SEEK", "NEXT", "PREVIOUS", "SET_SONG"]);
const PLAYLIST_EVENTS = new Set(["PLAYLIST_ADD", "PLAYLIST_REMOVE", "PLAYLIST_REORDER"]);
async function handleMessage(socket, participantId, roomId, raw) {
    // -------------------------------------------------------------------------
    // Parse
    // -------------------------------------------------------------------------
    let envelope;
    try {
        const text = raw.toString();
        const parsed = JSON.parse(text);
        if (typeof parsed !== "object" ||
            parsed === null ||
            typeof parsed["type"] !== "string") {
            (0, connectionManager_js_1.sendTo)(socket, (0, wsTypes_js_1.makeErrorEvent)("INVALID_EVENT", "Message must be a JSON object with a 'type' field."));
            return;
        }
        envelope = parsed;
    }
    catch {
        (0, connectionManager_js_1.sendTo)(socket, (0, wsTypes_js_1.makeErrorEvent)("INVALID_EVENT", "Message is not valid JSON."));
        return;
    }
    // -------------------------------------------------------------------------
    // Re-validate participant is still active in the connection manager
    // (covers the edge case where a disconnect races with a message)
    // -------------------------------------------------------------------------
    const connection = (0, connectionManager_js_1.getConnection)(participantId);
    if (!connection) {
        (0, connectionManager_js_1.sendTo)(socket, (0, wsTypes_js_1.makeErrorEvent)("PARTICIPANT_NOT_ACTIVE", "Your session is no longer active."));
        return;
    }
    // -------------------------------------------------------------------------
    // Route
    // -------------------------------------------------------------------------
    try {
        if (PLAYBACK_EVENTS.has(envelope.type)) {
            await (0, playback_js_1.handlePlayback)(socket, participantId, roomId, envelope);
            return;
        }
        if (PLAYLIST_EVENTS.has(envelope.type)) {
            await (0, playlist_js_1.handlePlaylist)(socket, participantId, roomId, envelope);
            return;
        }
        if (envelope.type === "CHAT_MESSAGE") {
            await (0, chat_js_1.handleChat)(socket, participantId, roomId, envelope);
            return;
        }
        (0, connectionManager_js_1.sendTo)(socket, (0, wsTypes_js_1.makeErrorEvent)("INVALID_EVENT", `Unknown event type: ${envelope.type}`, envelope.requestId));
    }
    catch (err) {
        console.error(`[ws] unhandled error participant=${participantId} type=${envelope.type}`, err);
        (0, connectionManager_js_1.sendTo)(socket, (0, wsTypes_js_1.makeErrorEvent)("INTERNAL_ERROR", "An unexpected error occurred.", envelope.requestId));
    }
}
//# sourceMappingURL=message.js.map