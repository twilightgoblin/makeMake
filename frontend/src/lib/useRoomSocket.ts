// -----------------------------------------------------------------------------
// Makemake — useRoomSocket
//
// Manages a single WebSocket connection for a room session.
//
// Usage:
//   const { roomState, send, status } = useRoomSocket({ roomId, participantId });
//
// The hook:
//   1. Opens ws://host/ws?participantId=<id>&roomId=<id> on mount
//   2. Parses every inbound envelope and updates roomState via reducer
//   3. Exposes `send` for dispatching client events (HOST playback, chat, etc.)
//   4. Cleans up the socket on unmount or when ids change
//
// RoomState is intentionally minimal for Phase 5 — just enough to drive the
// room screen. Playback sync (Phase 6) will extend it.
// -----------------------------------------------------------------------------

import { useCallback, useEffect, useReducer, useRef } from 'react';
import type {
  Participant,
  PendingJoinRequest,
  RoomStatus,
  WsClientEnvelope,
  WsClientEventType,
  WsJoinRequestPayload,
  WsJoinRequestResolvedPayload,
  WsRoomStatePayload,
  WsServerEnvelope,
  WsUserJoinedPayload,
  WsUserLeftPayload,
  WsHostChangedPayload,
} from '../types';

// ---------------------------------------------------------------------------
// State shape
// ---------------------------------------------------------------------------

export type SocketStatus = 'connecting' | 'open' | 'closed' | 'error';

export interface RoomState {
  roomId: string | null;
  status: RoomStatus | null;
  participants: Participant[];
  /** Pending join requests — populated for HOST only */
  pendingJoinRequests: PendingJoinRequest[];
  playback: {
    currentSongId: string | null;
    isPlaying: boolean;
    positionSecs: number;
    stateUpdatedAt: string | null;
  };
}

const INITIAL_ROOM_STATE: RoomState = {
  roomId: null,
  status: null,
  participants: [],
  pendingJoinRequests: [],
  playback: {
    currentSongId: null,
    isPlaying: false,
    positionSecs: 0,
    stateUpdatedAt: null,
  },
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
  | { type: 'PLAY'; payload: { songId: string | null; positionSecs: number; stateUpdatedAt: string } }
  | { type: 'PAUSE'; payload: { songId: string | null; positionSecs: number; stateUpdatedAt: string } }
  | { type: 'SEEK'; payload: { songId: string | null; positionSecs: number; stateUpdatedAt: string } }
  | { type: 'NEXT' | 'PREVIOUS'; payload: { songId: string | null; positionSecs: number; isPlaying: boolean; stateUpdatedAt: string } }
  | { type: 'ROOM_CLOSED' }
  | { type: 'RESET' };

function reducer(state: RoomState, action: RoomAction): RoomState {
  switch (action.type) {
    case 'ROOM_STATE':
      return {
        ...state,
        roomId: action.payload.roomId,
        status: action.payload.status,
        // Participants in ROOM_STATE are those with active WS connections,
        // so mark them all online.
        participants: action.payload.participants.map((p) => ({ ...p, isOnline: true })),
        playback: action.payload.playback,
      };

    case 'USER_JOINED':
      // Avoid duplicates (reconnect edge case) — update role/online status if already present.
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
        participants: [...state.participants, { ...action.payload.participant, isOnline: true }],
      };

    case 'USER_LEFT':
      return {
        ...state,
        participants: state.participants.map((p) =>
          p.id === action.payload.participantId
            ? { ...p, isOnline: false }
            : p,
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
      // Only the HOST receives this; add to pending list if not already there.
      if (state.pendingJoinRequests.some((r) => r.id === action.payload.joinRequest.id)) {
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
      // When accepted, eagerly add the participant so the HOST sees them
      // immediately — before the joiner's WebSocket connection fires USER_JOINED.
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
    case 'PAUSE':
    case 'SEEK':
      return {
        ...state,
        playback: {
          currentSongId: action.payload.songId,
          isPlaying: action.type === 'PLAY',
          positionSecs: action.payload.positionSecs,
          stateUpdatedAt: action.payload.stateUpdatedAt,
        },
      };

    case 'NEXT':
    case 'PREVIOUS':
      return {
        ...state,
        playback: {
          currentSongId: action.payload.songId,
          isPlaying: action.payload.isPlaying,
          positionSecs: action.payload.positionSecs,
          stateUpdatedAt: action.payload.stateUpdatedAt,
        },
      };

    case 'ROOM_CLOSED':
      return { ...state, status: 'CLOSED' };

    case 'RESET':
      return INITIAL_ROOM_STATE;

    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

interface UseRoomSocketOptions {
  roomId: string;
  participantId: string;
  /** Called when the server sends a fatal close (room closed, kicked, etc.) */
  onFatalClose?: (reason: string) => void;
}

interface UseRoomSocketReturn {
  roomState: RoomState;
  socketStatus: SocketStatus;
  /** Send a client event. Silently drops if socket is not open. */
  send: <T>(type: WsClientEventType, payload: T, requestId?: string) => void;
}

export function useRoomSocket({
  roomId,
  participantId,
  onFatalClose,
}: UseRoomSocketOptions): UseRoomSocketReturn {
  const [roomState, dispatch] = useReducer(reducer, INITIAL_ROOM_STATE);
  const socketRef = useRef<WebSocket | null>(null);
  const socketStatusRef = useRef<SocketStatus>('connecting');
  // Use a ref + force-update pattern so socketStatus flows into renders.
  const [, forceUpdate] = useReducer((n: number) => n + 1, 0);

  const setSocketStatus = useCallback((s: SocketStatus) => {
    socketStatusRef.current = s;
    forceUpdate();
  }, []);

  // Keep onFatalClose stable in a ref so the effect doesn't re-run on every render.
  const onFatalCloseRef = useRef(onFatalClose);
  useEffect(() => { onFatalCloseRef.current = onFatalClose; }, [onFatalClose]);

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
        case 'ROOM_STATE':
          dispatch({ type: 'ROOM_STATE', payload: payload as WsRoomStatePayload });
          break;
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
          dispatch({ type: 'JOIN_REQUEST', payload: payload as WsJoinRequestPayload });
          break;
        case 'JOIN_REQUEST_RESOLVED':
          dispatch({ type: 'JOIN_REQUEST_RESOLVED', payload: payload as WsJoinRequestResolvedPayload });
          break;
        case 'PLAY':
          dispatch({ type: 'PLAY', payload: payload as { songId: string | null; positionSecs: number; stateUpdatedAt: string } });
          break;
        case 'PAUSE':
          dispatch({ type: 'PAUSE', payload: payload as { songId: string | null; positionSecs: number; stateUpdatedAt: string } });
          break;
        case 'SEEK':
          dispatch({ type: 'SEEK', payload: payload as { songId: string | null; positionSecs: number; stateUpdatedAt: string } });
          break;
        case 'NEXT':
        case 'PREVIOUS':
          dispatch({ type, payload: payload as { songId: string | null; positionSecs: number; isPlaying: boolean; stateUpdatedAt: string } });
          break;
        case 'ROOM_CLOSED':
          dispatch({ type: 'ROOM_CLOSED' });
          onFatalCloseRef.current?.('Room was closed by the host.');
          break;
        case 'ERROR': {
          const err = payload as { code: string; message: string };
          console.error('[ws] server error', err.code, err.message);
          break;
        }
        default:
          // Unhandled events (PLAYLIST_*, CHAT_MESSAGE) — ignored in Phase 5.
          break;
      }
    };

    ws.onerror = () => {
      setSocketStatus('error');
    };

    ws.onclose = (event) => {
      setSocketStatus('closed');
      // 1008 = policy violation — server rejected this connection (bad params, room closed, etc.)
      if (event.code === 1008) {
        onFatalCloseRef.current?.(event.reason || 'Connection refused.');
      }
    };

    return () => {
      ws.onopen = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.onclose = null;
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close(1000, 'Component unmounted');
      }
      socketRef.current = null;
    };
  }, [roomId, participantId, setSocketStatus]);

  const send = useCallback(
    <T>(type: WsClientEventType, payload: T, requestId?: string) => {
      const ws = socketRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      const envelope: WsClientEnvelope<T> = { type, payload, ...(requestId && { requestId }) };
      ws.send(JSON.stringify(envelope));
    },
    [],
  );

  return {
    roomState,
    socketStatus: socketStatusRef.current,
    send,
  };
}
