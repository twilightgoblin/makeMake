// -----------------------------------------------------------------------------
// Makemake — shared frontend types
// These mirror the backend API response shapes and WebSocket protocol exactly.
// -----------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Song
// ---------------------------------------------------------------------------

export interface Song {
  id: string;
  title: string;
  artist: string;
  album: string | null;
  duration: number; // seconds (integer)
  coverUrl: string;
  audioUrl: string;
}

export interface SongsResponse {
  songs: Song[];
  total: number;
  limit: number;
  offset: number;
}

// ---------------------------------------------------------------------------
// AudioPlayer state — what the player exposes to React
// ---------------------------------------------------------------------------

export type PlayerStatus =
  | 'idle'      // no song loaded
  | 'loading'   // src set, waiting for canplay
  | 'playing'
  | 'paused'
  | 'ended'
  | 'error';

export interface PlayerState {
  status: PlayerStatus;
  song: Song | null;
  positionSecs: number;
  durationSecs: number;
  volume: number;       // 0–1
  /** Index into the current queue, or -1 if none */
  queueIndex: number;
}

// ---------------------------------------------------------------------------
// Room & Participants
// ---------------------------------------------------------------------------

export type RoomStatus = 'ACTIVE' | 'INACTIVE' | 'CLOSED';
export type ParticipantRole = 'HOST' | 'MEMBER';

export interface Participant {
  id: string;
  displayName: string;
  role: ParticipantRole;
  joinedAt?: string; // ISO — present on HTTP responses, absent in WS snapshots
  isOnline?: boolean; // present on HTTP responses; WS events carry connected participants only
}

export interface PlaybackState {
  currentSong: Song | null;
  isPlaying: boolean;
  positionSecs: number;
  stateUpdatedAt: string | null; // ISO timestamp
}

export interface PendingJoinRequest {
  id: string;
  displayName: string;
  status: 'PENDING';
  createdAt: string;
}

/** Full room snapshot returned by GET /rooms/:id */
export interface RoomDetail {
  id: string;
  code: string;
  status: RoomStatus;
  playback: PlaybackState;
  participants: Participant[];
  /** Present only when the caller is HOST */
  pendingJoinRequests?: PendingJoinRequest[];
}

/** Identity stored in sessionStorage after room creation / join acceptance */
export interface LocalParticipant {
  id: string;
  displayName: string;
  role: ParticipantRole;
  roomId: string;
  roomCode: string;
}

// ---------------------------------------------------------------------------
// HTTP API response shapes
// ---------------------------------------------------------------------------

export interface CreateRoomResponse {
  room: { id: string; code: string; status: RoomStatus };
  participant: { id: string; displayName: string; role: ParticipantRole };
}

export interface JoinRequestResponse {
  joinRequest: {
    id: string;
    displayName: string;
    status: 'PENDING' | 'ACCEPTED' | 'REJECTED';
    roomId: string;
    createdAt: string;
    resolvedAt: string | null;
  };
  /** Present when status === 'ACCEPTED' */
  participant?: {
    id: string;
    displayName: string;
    role: ParticipantRole;
    roomId: string;
    joinedAt: string;
  };
}

export interface JoinRequestStatusResponse {
  joinRequest: {
    id: string;
    displayName: string;
    status: 'PENDING' | 'ACCEPTED' | 'REJECTED';
    roomId: string;
    createdAt: string;
    resolvedAt: string | null;
  };
  /** Present when status === 'ACCEPTED' — gives the joiner their participant id */
  participant?: {
    id: string;
    role: ParticipantRole;
    roomId: string;
  };
}

export interface ResolveJoinRequestResponse {
  joinRequest: {
    id: string;
    displayName: string;
    status: 'ACCEPTED' | 'REJECTED';
    roomId: string;
    resolvedAt: string | null;
  };
  participant?: {
    id: string;
    displayName: string;
    role: ParticipantRole;
    roomId: string;
    joinedAt: string;
  };
}

// ---------------------------------------------------------------------------
// WebSocket — Server → Client event types
// ---------------------------------------------------------------------------

export type WsServerEventType =
  | 'ROOM_STATE'
  | 'PLAY'
  | 'PAUSE'
  | 'SEEK'
  | 'NEXT'
  | 'PREVIOUS'
  | 'PLAYLIST_ADD'
  | 'PLAYLIST_REMOVE'
  | 'PLAYLIST_REORDER'
  | 'CHAT_MESSAGE'
  | 'USER_JOINED'
  | 'USER_LEFT'
  | 'HOST_CHANGED'
  | 'ROOM_CLOSED'
  | 'JOIN_REQUEST'
  | 'JOIN_REQUEST_RESOLVED'
  | 'ERROR';

export interface WsServerEnvelope<T = unknown> {
  type: WsServerEventType;
  payload: T;
  timestamp: string; // ISO
}

// Per-event payload shapes (Server → Client)

export interface WsRoomStatePayload {
  roomId: string;
  status: RoomStatus;
  playback: {
    currentSongId: string | null;
    isPlaying: boolean;
    positionSecs: number;
    stateUpdatedAt: string | null;
  };
  participants: Participant[];
}

export interface WsPlayPayload {
  songId: string | null;
  positionSecs: number;
  stateUpdatedAt: string;
}

export interface WsPausePayload {
  songId: string | null;
  positionSecs: number;
  stateUpdatedAt: string;
}

export interface WsSeekPayload {
  songId: string | null;
  positionSecs: number;
  stateUpdatedAt: string;
}

export interface WsSongChangePayload {
  songId: string | null;
  positionSecs: number;
  isPlaying: boolean;
  stateUpdatedAt: string;
}

export interface WsUserJoinedPayload {
  participant: Participant;
}

export interface WsUserLeftPayload {
  participantId: string;
  displayName: string;
}

export interface WsHostChangedPayload {
  newHostId: string;
  newHostDisplayName: string;
}

export interface WsJoinRequestPayload {
  joinRequest: {
    id: string;
    displayName: string;
    status: 'PENDING';
    roomId: string;
    createdAt: string;
  };
}

export interface WsJoinRequestResolvedPayload {
  joinRequestId: string;
  action: 'ACCEPTED' | 'REJECTED';
  participant?: {
    id: string;
    displayName: string;
    role: ParticipantRole;
    roomId: string;
  };
}

export interface WsErrorPayload {
  code: string;
  message: string;
  requestId?: string;
}

// ---------------------------------------------------------------------------
// WebSocket — Client → Server event types
// ---------------------------------------------------------------------------

export type WsClientEventType =
  | 'PLAY'
  | 'PAUSE'
  | 'SEEK'
  | 'NEXT'
  | 'PREVIOUS'
  | 'PLAYLIST_ADD'
  | 'PLAYLIST_REMOVE'
  | 'PLAYLIST_REORDER'
  | 'CHAT_MESSAGE';

export interface WsClientEnvelope<T = unknown> {
  type: WsClientEventType;
  requestId?: string;
  payload: T;
}
