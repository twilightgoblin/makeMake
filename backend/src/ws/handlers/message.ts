// -----------------------------------------------------------------------------
// Makemake — WS message dispatcher
//
// Parses every raw message from a client socket, validates the envelope shape,
// and routes to the appropriate domain handler.
// All handler errors are caught here and sent back as ERROR events.
// -----------------------------------------------------------------------------

import type WebSocket from "ws";
import type { RawData } from "ws";
import {
  makeErrorEvent,
  type ClientEnvelope,
  type ClientEventType,
} from "../../lib/wsTypes.js";
import { sendTo, getConnection } from "../connectionManager.js";
import { handlePlayback } from "./playback.js";
import { handlePlaylist } from "./playlist.js";
import { handleChat } from "./chat.js";

const PLAYBACK_EVENTS = new Set<ClientEventType>(["PLAY", "PAUSE", "SEEK", "NEXT", "PREVIOUS", "SET_SONG"]);
const PLAYLIST_EVENTS = new Set<ClientEventType>(["PLAYLIST_ADD", "PLAYLIST_REMOVE", "PLAYLIST_REORDER"]);

export async function handleMessage(
  socket: WebSocket,
  participantId: string,
  roomId: string,
  raw: RawData,
): Promise<void> {
  // -------------------------------------------------------------------------
  // Parse
  // -------------------------------------------------------------------------
  let envelope: ClientEnvelope;
  try {
    const text = raw.toString();
    const parsed = JSON.parse(text) as unknown;

    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as Record<string, unknown>)["type"] !== "string"
    ) {
      sendTo(socket, makeErrorEvent("INVALID_EVENT", "Message must be a JSON object with a 'type' field."));
      return;
    }

    envelope = parsed as ClientEnvelope;
  } catch {
    sendTo(socket, makeErrorEvent("INVALID_EVENT", "Message is not valid JSON."));
    return;
  }

  // -------------------------------------------------------------------------
  // Re-validate participant is still active in the connection manager
  // (covers the edge case where a disconnect races with a message)
  // -------------------------------------------------------------------------
  const connection = getConnection(participantId);
  if (!connection) {
    sendTo(socket, makeErrorEvent("PARTICIPANT_NOT_ACTIVE", "Your session is no longer active."));
    return;
  }

  // -------------------------------------------------------------------------
  // Route
  // -------------------------------------------------------------------------
  try {
    if (PLAYBACK_EVENTS.has(envelope.type as ClientEventType)) {
      await handlePlayback(socket, participantId, roomId, envelope);
      return;
    }

    if (PLAYLIST_EVENTS.has(envelope.type as ClientEventType)) {
      await handlePlaylist(socket, participantId, roomId, envelope);
      return;
    }

    if (envelope.type === "CHAT_MESSAGE") {
      await handleChat(socket, participantId, roomId, envelope);
      return;
    }

    sendTo(
      socket,
      makeErrorEvent(
        "INVALID_EVENT",
        `Unknown event type: ${envelope.type}`,
        envelope.requestId,
      ),
    );
  } catch (err) {
    console.error(`[ws] unhandled error participant=${participantId} type=${envelope.type}`, err);
    sendTo(
      socket,
      makeErrorEvent("INTERNAL_ERROR", "An unexpected error occurred.", envelope.requestId),
    );
  }
}
