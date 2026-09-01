// -----------------------------------------------------------------------------
// Makemake — WS chat handler
//
// Handles: CHAT_MESSAGE
//
// Any active participant (HOST or MEMBER) can send messages.
// Server generates id, sentAt, and sender — the client is never trusted
// to supply those fields.
// -----------------------------------------------------------------------------

import type WebSocket from "ws";
import { prisma } from "../../lib/prisma.js";
import {
  makeServerEvent,
  makeErrorEvent,
  type ClientEnvelope,
  type ChatMessagePayload,
  type ChatMessageBroadcastPayload,
} from "../../lib/wsTypes.js";
import { sendTo } from "../connectionManager.js";
import { publishRoomEvent } from "../../lib/roomEvents.js";
import { wsRateLimit } from "../rateLimit.js";

const MAX_CONTENT_LENGTH = 1000;

export async function handleChat(
  socket: WebSocket,
  participantId: string,
  roomId: string,
  envelope: ClientEnvelope,
): Promise<void> {
  // Rate limit: 20 chat messages per minute per participant
  const key = `rate-limit:chat:${participantId}`;
  if (!(await wsRateLimit(socket, key, 20, 60 * 1000))) {
    return;
  }

  const payload = envelope.payload as ChatMessagePayload;

  // -------------------------------------------------------------------------
  // Validate
  // -------------------------------------------------------------------------
  if (!payload?.content || typeof payload.content !== "string") {
    sendTo(socket, makeErrorEvent("INVALID_PAYLOAD", '"content" is required.', envelope.requestId));
    return;
  }

  const content = payload.content.trim();
  if (content.length === 0) {
    sendTo(socket, makeErrorEvent("INVALID_PAYLOAD", '"content" must not be empty.', envelope.requestId));
    return;
  }

  if (content.length > MAX_CONTENT_LENGTH) {
    sendTo(
      socket,
      makeErrorEvent(
        "INVALID_PAYLOAD",
        `"content" must be ${MAX_CONTENT_LENGTH} characters or fewer.`,
        envelope.requestId,
      ),
    );
    return;
  }

  // -------------------------------------------------------------------------
  // Persist
  // -------------------------------------------------------------------------
  const message = await prisma.message.create({
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
  const broadcast: ChatMessageBroadcastPayload = {
    id: message.id,
    content: message.content,
    sentAt: message.sentAt.toISOString(),
    sender: message.sender,
  };

  await publishRoomEvent(roomId, makeServerEvent("CHAT_MESSAGE", broadcast));
}
