// -----------------------------------------------------------------------------
// Makemake — WebSocket protocol types
//
// Every message over the wire uses the same outer envelope:
//
//   Client → Server:  { type, requestId?, payload }
//   Server → Client:  { type, payload, timestamp }
//
// This file defines the discriminated unions for both directions, plus the
// error event shape and all valid error codes.
// -----------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

/** ISO-8601 timestamp string */
export type ISOTimestamp = string;

// ---------------------------------------------------------------------------
// Client → Server events
// ---------------------------------------------------------------------------

export type ClientEventType =
  | "PLAY"
  | "PAUSE"
  | "SEEK"
  | "NEXT"
  | "PREVIOUS"
  | "SET_SONG"
  | "PLAYLIST_ADD"
  | "PLAYLIST_REMOVE"
  | "PLAYLIST_REORDER"
  | "CHAT_MESSAGE";

export interface ClientEnvelope<T = unknown> {
  type: ClientEventType;
  /** Client-generated correlation id — echoed back in error events. */
  requestId?: string;
  payload: T;
}

// Per-event payload types — client → server

export interface PlayPayload {
  positionSecs: number;
}

export interface PausePayload {
  positionSecs: number;
}

export interface SeekPayload {
  positionSecs: number;
}

/** NEXT and PREVIOUS carry no payload */
export type NextPayload = Record<string, never>;
export type PreviousPayload = Record<string, never>;

/** SET_SONG — HOST jumps directly to a specific playlist entry */
export interface SetSongPayload {
  entryId: string;
}

export interface PlaylistAddPayload {
  songId: string;
}

export interface PlaylistRemovePayload {
  entryId: string;
}

export interface PlaylistReorderPayload {
  entryId: string;
  newPosition: number;
}

export interface ChatMessagePayload {
  content: string;
}

// ---------------------------------------------------------------------------
// Server → Client events
// ---------------------------------------------------------------------------

export type ServerEventType =
  | "ROOM_STATE"
  | "PLAY"
  | "PAUSE"
  | "SEEK"
  | "NEXT"
  | "PREVIOUS"
  | "PLAYLIST_ADD"
  | "PLAYLIST_REMOVE"
  | "PLAYLIST_REORDER"
  | "CHAT_MESSAGE"
  | "USER_JOINED"
  | "USER_LEFT"
  | "HOST_CHANGED"
  | "ROOM_CLOSED"
  | "JOIN_REQUEST"
  | "JOIN_REQUEST_RESOLVED"
  | "ERROR";

export interface ServerEnvelope<T = unknown> {
  type: ServerEventType;
  payload: T;
  timestamp: ISOTimestamp;
}

// Per-event payload types — server → client

export interface ParticipantSummary {
  id: string;
  displayName: string;
  role: "HOST" | "MEMBER";
}

export interface PlaybackSongSummary {
  id: string;
  title: string;
  artist: string;
  album: string | null;
  duration: number;
  coverUrl: string;
  audioUrl: string;
}

export interface PlaybackState {
  currentSong: PlaybackSongSummary | null;
  isPlaying: boolean;
  positionSecs: number;
  stateUpdatedAt: ISOTimestamp | null;
}

export interface RoomStatePayload {
  roomId: string;
  status: "ACTIVE" | "INACTIVE" | "CLOSED";
  playback: PlaybackState;
  participants: ParticipantSummary[];
}

export interface PlayBroadcastPayload {
  songId: string | null;
  positionSecs: number;
  stateUpdatedAt: ISOTimestamp;
}

export interface PauseBroadcastPayload {
  songId: string | null;
  positionSecs: number;
  stateUpdatedAt: ISOTimestamp;
}

export interface SeekBroadcastPayload {
  songId: string | null;
  positionSecs: number;
  stateUpdatedAt: ISOTimestamp;
}

export interface SongChangeBroadcastPayload {
  songId: string | null;
  positionSecs: number;
  isPlaying: boolean;
  stateUpdatedAt: ISOTimestamp;
}

export interface PlaylistAddBroadcastPayload {
  entry: {
    id: string;
    position: number;
    addedById: string | null;
    addedAt: ISOTimestamp;
    song: {
      id: string;
      title: string;
      artist: string;
      album: string | null;
      duration: number;
      coverUrl: string;
      audioUrl: string;
    };
  };
}

export interface PlaylistRemoveBroadcastPayload {
  entryId: string;
  /** Updated ordered list after removal */
  playlist: Array<{ id: string; position: number }>;
}

export interface PlaylistReorderBroadcastPayload {
  entryId: string;
  /** Updated ordered list after reorder */
  playlist: Array<{ id: string; position: number }>;
}

export interface ChatMessageBroadcastPayload {
  id: string;
  content: string;
  sentAt: ISOTimestamp;
  sender: { id: string; displayName: string };
}

export interface UserJoinedPayload {
  participant: ParticipantSummary;
}

export interface UserLeftPayload {
  participantId: string;
  displayName: string;
}

export interface HostChangedPayload {
  newHostId: string;
  newHostDisplayName: string;
}

export type RoomClosedPayload = Record<string, never>;

/** Sent to the HOST when a new join request arrives. */
export interface JoinRequestPayload {
  joinRequest: {
    id: string;
    displayName: string;
    status: "PENDING";
    roomId: string;
    createdAt: ISOTimestamp;
  };
}

/**
 * Sent to the requesting participant after the HOST accepts or rejects.
 * Also broadcast to the full room on ACCEPT so everyone sees the new member
 * before the WS handshake completes.
 */
export interface JoinRequestResolvedPayload {
  joinRequestId: string;
  action: "ACCEPTED" | "REJECTED";
  /** Present only when action === "ACCEPTED" */
  participant?: {
    id: string;
    displayName: string;
    role: "HOST" | "MEMBER";
    roomId: string;
  };
}

// ---------------------------------------------------------------------------
// Error event
// ---------------------------------------------------------------------------

export type WsErrorCode =
  | "INVALID_EVENT"
  | "INVALID_PAYLOAD"
  | "MISSING_PARTICIPANT"
  | "PARTICIPANT_NOT_ACTIVE"
  | "HOST_ONLY"
  | "ROOM_CLOSED"
  | "ROOM_NOT_FOUND"
  | "SONG_NOT_FOUND"
  | "PLAYLIST_ENTRY_NOT_FOUND"
  | "SEEK_OUT_OF_RANGE"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR";

export interface WsErrorPayload {
  code: WsErrorCode;
  message: string;
  /** Echoed from the client's requestId when available */
  requestId?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a server-side envelope ready for JSON serialization */
export function makeServerEvent<T>(
  type: ServerEventType,
  payload: T,
): ServerEnvelope<T> {
  return { type, payload, timestamp: new Date().toISOString() };
}

/** Build an ERROR envelope */
export function makeErrorEvent(
  code: WsErrorCode,
  message: string,
  requestId?: string,
): ServerEnvelope<WsErrorPayload> {
  return makeServerEvent("ERROR", { code, message, requestId });
}
