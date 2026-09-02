// -----------------------------------------------------------------------------
// Makemake — useRoomSocket
//
// Manages a single WebSocket connection for a room session.
//
// Usage:
//   const { roomState, send, socketStatus } = useRoomSocket({ roomId, participantId });
//
// The hook:
//   1. Opens ws://host/ws?participantId=<id>&roomId=<id> on mount
//   2. Parses every inbound envelope and updates roomState via reducer
//   3. Exposes `send` for dispatching client events (HOST playback, chat, etc.)
//   4. Cleans up the socket on unmount or when ids change
//
// RoomState.playback carries the full Song object (from Phase 6 onwards) and
// a raw `anchor` record that the drift-correction loop uses to recompute the
// live position without going through the reducer.
// -----------------------------------------------------------------------------

import { useCallback, useEffect, useReducer, useRef } from 'react';
import type {
  Participant,
  PendingJoinRequest,
  RoomStatus,
  Song,
  WsClientEnvelope,
  WsClientEventType,
  WsHostChangedPayload,
  WsJoinRequestPayload,
  WsJoinRequestResolvedPayload,
  WsRoomStatePayload,
  WsServerEnvelope,
  WsUserJoinedPayload,
  WsUserLeftPayload,
} from '../types';
import { type LivePlaybackState, type PlaylistEntry } from './api';

// ---------------------------------------------------------------------------
// State shape
// ---------------------------------------------------------------------------

export type SocketStatus = 'connecting' | 'open' | 'closed' | 'error';

/**
 * The raw anchor the server sent — used by computeLivePosition in the drift
 * correction loop. Kept separate from the derived `song` field so consumers
 * never have to reconstruct the original server values.
 */
export interface PlaybackAnchor {
  currentSong: Song | null;
  isPlaying: boolean;
  positionSecs: number;
  stateUpdatedAt: string | null;
}

export interface ChatMessageRecord {
  id: string;
  content: string;
  sentAt: string;
  sender: { id: string; displayName: string };
}

export interface RoomState {
  roomId: string | null;
  status: RoomStatus | null;
  participants: Participant[];
  /** Pending join requests — populated for HOST only */
  pendingJoinRequests: PendingJoinRequest[];
  /**
   * The ordered room playlist — kept live by PLAYLIST_ADD/REMOVE/REORDER
   * WS events. Seeded from the initial HTTP fetch via seedPlaylist().
   */
  playlist: PlaylistEntry[];
  /**
   * The live playback anchor — matches the last server broadcast exactly.
   * RoomPage uses computeLivePosition(playback) to derive the actual audio
   * position at any moment.
   */
  playback: PlaybackAnchor;
  /** Chat messages received via CHAT_MESSAGE broadcasts */
  messages: ChatMessageRecord[];
}

const INITIAL_PLAYBACK: PlaybackAnchor = {
  currentSong: null,
  isPlaying: false,
  positionSecs: 0,
  stateUpdatedAt: null,
};

const INITIAL_ROOM_STATE: RoomState = {
  roomId: null,
  status: null,
  participants: [],
  pendingJoinRequests: [],
  playlist: [],
  playback: INITIAL_PLAYBACK,
  messages: [],
};

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

type RoomAction =
  | { type: 'ROOM_STATE'; payload: WsRoomStatePayload }
  | { type: 'USER_JOINED'; payload: WsUserJoinedPayload }
  | { type: 'USER_LEFT'; payload: WsUserLeftPayload }
  | { type: 'HOST_CHANGED'; payload: WsHostChangedPayload }
  | { type: 'JOIN_REQUEST'; payload: WsJoinRequestPayload }
  | { type: 'JOIN_REQUEST_RESOLVED'; payload: WsJoinRequestResolvedPayload }
  | {
      type: 'PLAY' | 'PAUSE' | 'SEEK';
      payload: { songId: string | null; positionSecs: number; stateUpdatedAt: string };
      song: Song | null;
    }
  | {
      type: 'NEXT' | 'PREVIOUS';
      payload: {
        songId: string | null;
        positionSecs: number;
        isPlaying: boolean;
        stateUpdatedAt: string;
      };
      song: Song | null;
    }
  | { type: 'PLAYLIST_ADD'; payload: { entry: PlaylistEntry } }
  | { type: 'PLAYLIST_REMOVE'; payload: { entryId: string; playlist: Array<{ id: string; position: number }> } }
  | { type: 'PLAYLIST_REORDER'; payload: { entryId: string; playlist: Array<{ id: string; position: number }> } }
  | { type: 'SEED_PLAYLIST'; playlist: PlaylistEntry[] }
  | { type: 'CHAT_MESSAGE'; payload: ChatMessageRecord }
  | { type: 'ROOM_CLOSED' }
  | { type: 'RESET' };

function reducer(state: RoomState, action: RoomAction): RoomState {
  switch (action.type) {
    case 'ROOM_STATE':
      return {
        ...state,
        roomId: action.payload.roomId,
        status: action.payload.status,
        participants: action.payload.participants.map((p) => ({
          ...p,
          isOnline: true,
        })),
        playback: {
          currentSong: action.payload.playback.currentSong,
          isPlaying: action.payload.playback.isPlaying,
          positionSecs: action.payload.playback.positionSecs,
          stateUpdatedAt: action.payload.playback.stateUpdatedAt,
        },
      };

    case 'USER_JOINED':
      if (state.participants.some((p) => p.id === action.payload.participant.id)) {
        return {
          ...state,
          participants: state.participants.map((p) =>
            p.id === action.payload.participant.id
              ? { ...p, ...action.payload.participant, isOnline: true }
              : p,
          ),
        };
      }
      return {
        ...state,
        participants: [
          ...state.participants,
          { ...action.payload.participant, isOnline: true },
        ],
      };

    case 'USER_LEFT':
      return {
        ...state,
        participants: state.participants.map((p) =>
          p.id === action.payload.participantId ? { ...p, isOnline: false } : p,
        ),
      };

    case 'HOST_CHANGED':
      return {
        ...state,
        participants: state.participants.map((p) =>
          p.id === action.payload.newHostId
            ? { ...p, role: 'HOST' }
            : { ...p, role: 'MEMBER' },
        ),
      };

    case 'JOIN_REQUEST':
      if (
        state.pendingJoinRequests.some((r) => r.id === action.payload.joinRequest.id)
      ) {
        return state;
      }
      return {
        ...state,
        pendingJoinRequests: [
          ...state.pendingJoinRequests,
          action.payload.joinRequest,
        ],
      };

    case 'JOIN_REQUEST_RESOLVED': {
      const next: RoomState = {
        ...state,
        pendingJoinRequests: state.pendingJoinRequests.filter(
          (r) => r.id !== action.payload.joinRequestId,
        ),
      };
      if (
        action.payload.action === 'ACCEPTED' &&
        action.payload.participant &&
        !next.participants.some((p) => p.id === action.payload.participant!.id)
      ) {
        next.participants = [...next.participants, action.payload.participant];
      }
      return next;
    }

    case 'PLAY':
      return {
        ...state,
        playback: {
          currentSong: action.song ?? state.playback.currentSong,
          isPlaying: true,
          positionSecs: action.payload.positionSecs,
          stateUpdatedAt: action.payload.stateUpdatedAt,
        },
      };

    case 'PAUSE':
      return {
        ...state,
        playback: {
          currentSong: action.song ?? state.playback.currentSong,
          isPlaying: false,
          positionSecs: action.payload.positionSecs,
          stateUpdatedAt: action.payload.stateUpdatedAt,
        },
      };

    case 'SEEK':
      return {
        ...state,
        playback: {
          // SEEK doesn't change isPlaying
          currentSong: action.song ?? state.playback.currentSong,
          isPlaying: state.playback.isPlaying,
          positionSecs: action.payload.positionSecs,
          stateUpdatedAt: action.payload.stateUpdatedAt,
        },
      };

    case 'NEXT':
    case 'PREVIOUS':
      return {
        ...state,
        playback: {
          currentSong: action.song,
          isPlaying: action.payload.isPlaying,
          positionSecs: action.payload.positionSecs,
          stateUpdatedAt: action.payload.stateUpdatedAt,
        },
      };

    case 'PLAYLIST_ADD':
      // Avoid duplicates (e.g. the sender receives their own broadcast)
      if (state.playlist.some((e) => e.id === action.payload.entry.id)) {
        return state;
      }
      return {
        ...state,
        playlist: [...state.playlist, action.payload.entry].sort(
          (a, b) => a.position - b.position,
        ),
      };

    case 'PLAYLIST_REMOVE': {
      // The server sends the updated position list; apply it to preserve order.
      const posMap = new Map(action.payload.playlist.map((p) => [p.id, p.position]));
      return {
        ...state,
        playlist: state.playlist
          .filter((e) => e.id !== action.payload.entryId)
          .map((e) => ({ ...e, position: posMap.get(e.id) ?? e.position }))
          .sort((a, b) => a.position - b.position),
      };
    }

    case 'PLAYLIST_REORDER': {
      const posMap = new Map(action.payload.playlist.map((p) => [p.id, p.position]));
      return {
        ...state,
        playlist: state.playlist
          .map((e) => ({ ...e, position: posMap.get(e.id) ?? e.position }))
          .sort((a, b) => a.position - b.position),
      };
    }

    case 'SEED_PLAYLIST':
      return { ...state, playlist: action.playlist };

    case 'CHAT_MESSAGE':
      // Deduplicate by id (sender receives their own broadcast)
      if (state.messages.some((m) => m.id === action.payload.id)) {
        return state;
      }
      return { ...state, messages: [...state.messages, action.payload] };

    case 'ROOM_CLOSED':
      return { ...state, status: 'CLOSED' };

    case 'RESET':
      return INITIAL_ROOM_STATE;

    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Song resolution cache
//
// PLAY/PAUSE/SEEK carry only a songId, not the full song object.
// We cache songs by id so we can enrich reducer actions without an async
// fetch on every event. Songs are populated from:
//   a) ROOM_STATE.playback.currentSong  (on connect)
//   b) NEXT/PREVIOUS broadcasts         (server sends songId; RoomPage playlist
//      already has the full object)
//
// In practice the song will almost always already be in the cache.
// ---------------------------------------------------------------------------

const songCache = new Map<string, Song>();

function cacheSong(song: Song | null | undefined): void {
  if (song) songCache.set(song.id, song);
}

function lookupSong(songId: string | null | undefined): Song | null {
  if (!songId) return null;
  return songCache.get(songId) ?? null;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

interface UseRoomSocketOptions {
  roomId: string;
  participantId: string;
  /** Called when the server sends a fatal close (room closed, kicked, etc.) */
  onFatalClose?: (reason: string) => void;
  /**
   * Optional song lookup function supplied by RoomPage so the hook can
   * resolve NEXT/PREVIOUS songIds to full Song objects from the local playlist.
   */
  resolveSong?: (songId: string) => Song | undefined;
}

interface UseRoomSocketReturn {
  roomState: RoomState;
  socketStatus: SocketStatus;
  /** Send a client event. Silently drops if socket is not open. */
  send: <T>(type: WsClientEventType, payload: T, requestId?: string) => void;
  /**
   * Convenience alias for roomState.playback typed as LivePlaybackState,
   * ready to pass directly to computeLivePosition().
   */
  livePlayback: LivePlaybackState;
  /**
   * Seed the playlist from the initial HTTP fetch. Should be called once
   * after the playlist is loaded from the API. Subsequent mutations come
   * from WS events (PLAYLIST_ADD/REMOVE/REORDER).
   */
  seedPlaylist: (entries: PlaylistEntry[]) => void;
}

export function useRoomSocket({
  roomId,
  participantId,
  onFatalClose,
  resolveSong,
}: UseRoomSocketOptions): UseRoomSocketReturn {
  const [roomState, dispatch] = useReducer(reducer, INITIAL_ROOM_STATE);
  const socketRef = useRef<WebSocket | null>(null);
  const socketStatusRef = useRef<SocketStatus>('connecting');
  const [, forceUpdate] = useReducer((n: number) => n + 1, 0);

  // Keep callbacks stable in refs so the effect doesn't re-run.
  const onFatalCloseRef = useRef(onFatalClose);
  const resolveSongRef = useRef(resolveSong);
  useEffect(() => {
    onFatalCloseRef.current = onFatalClose;
  }, [onFatalClose]);
  useEffect(() => {
    resolveSongRef.current = resolveSong;
  }, [resolveSong]);

  const setSocketStatus = useCallback((s: SocketStatus) => {
    socketStatusRef.current = s;
    forceUpdate();
  }, []);

  useEffect(() => {
    if (!roomId || !participantId) return;

    dispatch({ type: 'RESET' });
    setSocketStatus('connecting');

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const url = `${protocol}//${host}/ws?participantId=${encodeURIComponent(participantId)}&roomId=${encodeURIComponent(roomId)}`;

    const ws = new WebSocket(url);
    socketRef.current = ws;

    ws.onopen = () => {
      setSocketStatus('open');
    };

    ws.onmessage = (event) => {
      let envelope: WsServerEnvelope;
      try {
        envelope = JSON.parse(event.data as string) as WsServerEnvelope;
      } catch {
        console.warn('[ws] received non-JSON message', event.data);
        return;
      }

      const { type, payload } = envelope;

      switch (type) {
        case 'ROOM_STATE': {
          const p = payload as WsRoomStatePayload;
          // Seed the song cache from the initial state
          cacheSong(p.playback.currentSong);
          dispatch({ type: 'ROOM_STATE', payload: p });
          break;
        }

        case 'USER_JOINED':
          dispatch({ type: 'USER_JOINED', payload: payload as WsUserJoinedPayload });
          break;

        case 'USER_LEFT':
          dispatch({ type: 'USER_LEFT', payload: payload as WsUserLeftPayload });
          break;

        case 'HOST_CHANGED':
          dispatch({ type: 'HOST_CHANGED', payload: payload as WsHostChangedPayload });
          break;

        case 'JOIN_REQUEST':
          dispatch({
            type: 'JOIN_REQUEST',
            payload: payload as WsJoinRequestPayload,
          });
          break;

        case 'JOIN_REQUEST_RESOLVED':
          dispatch({
            type: 'JOIN_REQUEST_RESOLVED',
            payload: payload as WsJoinRequestResolvedPayload,
          });
          break;

        case 'PLAY':
        case 'PAUSE':
        case 'SEEK': {
          const p = payload as {
            songId: string | null;
            positionSecs: number;
            stateUpdatedAt: string;
          };
          // Try to resolve the song from the cache or RoomPage's playlist
          const song =
            (p.songId
              ? (resolveSongRef.current?.(p.songId) ?? lookupSong(p.songId))
              : null) ?? null;
          dispatch({ type, payload: p, song });
          break;
        }

        case 'NEXT':
        case 'PREVIOUS': {
          const p = payload as {
            songId: string | null;
            positionSecs: number;
            isPlaying: boolean;
            stateUpdatedAt: string;
          };
          const song =
            (p.songId
              ? (resolveSongRef.current?.(p.songId) ?? lookupSong(p.songId))
              : null) ?? null;
          dispatch({ type, payload: p, song });
          break;
        }

        case 'ROOM_CLOSED':
          dispatch({ type: 'ROOM_CLOSED' });
          onFatalCloseRef.current?.('Room was closed by the host.');
          break;

        case 'ERROR': {
          const err = payload as { code: string; message: string };
          console.error('[ws] server error', err.code, err.message);
          break;
        }

        case 'PLAYLIST_ADD': {
          const p = payload as { entry: PlaylistEntry };
          // Cache the song so playback resolution works
          cacheSong(p.entry.song);
          dispatch({ type: 'PLAYLIST_ADD', payload: p });
          break;
        }

        case 'PLAYLIST_REMOVE':
          dispatch({
            type: 'PLAYLIST_REMOVE',
            payload: payload as { entryId: string; playlist: Array<{ id: string; position: number }> },
          });
          break;

        case 'PLAYLIST_REORDER':
          dispatch({
            type: 'PLAYLIST_REORDER',
            payload: payload as { entryId: string; playlist: Array<{ id: string; position: number }> },
          });
          break;

        case 'CHAT_MESSAGE': {
          const p = payload as {
            id: string;
            content: string;
            sentAt: string;
            sender: { id: string; displayName: string };
          };
          dispatch({ type: 'CHAT_MESSAGE', payload: p });
          break;
        }

        default:
          break;
      }
    };

    ws.onerror = () => {
      setSocketStatus('error');
    };

    ws.onclose = (event) => {
      setSocketStatus('closed');
      if (event.code === 1008) {
        onFatalCloseRef.current?.(event.reason || 'Connection refused.');
      }
    };

    return () => {
      ws.onopen = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.onclose = null;
      if (
        ws.readyState === WebSocket.OPEN ||
        ws.readyState === WebSocket.CONNECTING
      ) {
        ws.close(1000, 'Component unmounted');
      }
      socketRef.current = null;
    };
  }, [roomId, participantId, setSocketStatus]);

  const send = useCallback(
    <T>(type: WsClientEventType, payload: T, requestId?: string) => {
      const ws = socketRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      const envelope: WsClientEnvelope<T> = {
        type,
        payload,
        ...(requestId && { requestId }),
      };
      ws.send(JSON.stringify(envelope));
    },
    [],
  );

  const seedPlaylist = useCallback((entries: PlaylistEntry[]) => {
    dispatch({ type: 'SEED_PLAYLIST', playlist: entries });
  }, []);

  return {
    roomState,
    socketStatus: socketStatusRef.current,
    send,
    livePlayback: roomState.playback,
    seedPlaylist,
  };
}
