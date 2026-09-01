"use strict";
// -----------------------------------------------------------------------------
// Makemake — WS chat handler
//
// Handles: CHAT_MESSAGE
//
// Any active participant (HOST or MEMBER) can send messages.
// Server generates id, sentAt, and sender — the client is never trusted
// to supply those fields.
// -----------------------------------------------------------------------------
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleChat = handleChat;
const prisma_js_1 = require("../../lib/prisma.js");
const wsTypes_js_1 = require("../../lib/wsTypes.js");
const connectionManager_js_1 = require("../connectionManager.js");
const roomEvents_js_1 = require("../../lib/roomEvents.js");
const rateLimit_js_1 = require("../rateLimit.js");
const MAX_CONTENT_LENGTH = 1000;
async function handleChat(socket, participantId, roomId, envelope) {
    // Rate limit: 20 chat messages per minute per participant
    const key = `rate-limit:chat:${participantId}`;
    if (!(await (0, rateLimit_js_1.wsRateLimit)(socket, key, 20, 60 * 1000))) {
        return;
    }
    const payload = envelope.payload;
    // -------------------------------------------------------------------------
    // Validate
    // -------------------------------------------------------------------------
    if (!payload?.content || typeof payload.content !== "string") {
        (0, connectionManager_js_1.sendTo)(socket, (0, wsTypes_js_1.makeErrorEvent)("INVALID_PAYLOAD", '"content" is required.', envelope.requestId));
        return;
    }
    const content = payload.content.trim();
    if (content.length === 0) {
        (0, connectionManager_js_1.sendTo)(socket, (0, wsTypes_js_1.makeErrorEvent)("INVALID_PAYLOAD", '"content" must not be empty.', envelope.requestId));
        return;
    }
    if (content.length > MAX_CONTENT_LENGTH) {
        (0, connectionManager_js_1.sendTo)(socket, (0, wsTypes_js_1.makeErrorEvent)("INVALID_PAYLOAD", `"content" must be ${MAX_CONTENT_LENGTH} characters or fewer.`, envelope.requestId));
        return;
    }
    // -------------------------------------------------------------------------
    // Persist
    // -------------------------------------------------------------------------
    const message = await prisma_js_1.prisma.message.create({
        data: {
            content,
            roomId,
            senderId: participantId,
        },
        select: {
            id: true,
            content: true,
            sentAt: true,
            sender: { select: { id: true, displayName: true } },
        },
    });
    // -------------------------------------------------------------------------
    // Broadcast to the whole room (including the sender so they get the
    // server-assigned id and sentAt rather than a locally-generated one)
    // -------------------------------------------------------------------------
    const broadcast = {
        id: message.id,
        content: message.content,
        sentAt: message.sentAt.toISOString(),
        sender: message.sender,
    };
    await (0, roomEvents_js_1.publishRoomEvent)(roomId, (0, wsTypes_js_1.makeServerEvent)("CHAT_MESSAGE", broadcast));
}
//# sourceMappingURL=chat.js.map