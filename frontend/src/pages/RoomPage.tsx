// -----------------------------------------------------------------------------
// Makemake — RoomPage
//
// Mounted at /room/:code. Responsibilities:
//
//   1. Identity resolution
//      a) Creator path: reads 'participant' from sessionStorage (set by HomePage)
//      b) Joiner path:  reads 'pendingIdentity', calls GET /rooms/:id to find
//         the newly-created participant row by displayName, then stores the
//         resolved identity back as 'participant'.
//
//   2. Room hydration
//      GET /rooms/:id  →  seeds initial state (participants, pending requests)
//
//   3. WebSocket connection
//      useRoomSocket(roomId, participantId) → live state updates
//
//   4. Renders
//      - RoomHeader (code + leave button)
//      - JoinRequestBanner (HOST only — incoming requests)
//      - ParticipantList
//      - PlayerArea (placeholder — wired in Phase 6)
// -----------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getRoomDetail, resolveJoinRequest, leaveRoom, ApiError } from '../lib/api';
import { useRoomSocket } from '../lib/useRoomSocket';
import { PlayerBar } from '../components/PlayerBar';
import { AudioPlayer } from '../lib/AudioPlayer';
import type { LocalParticipant, Participant, PendingJoinRequest, PlayerState } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readStoredParticipant(): LocalParticipant | null {
  try {
    const raw = sessionStorage.getItem('participant');
    return raw ? (JSON.parse(raw) as LocalParticipant) : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function RoomHeader({
  code,
  onLeave,
  leaving,
}: {
  code: string;
  onLeave: () => void;
  leaving: boolean;
}) {
  return (
    <header className="room-header">
      <div className="room-header-left">
        <span className="app-logo">♪</span>
        <span className="room-code">{code}</span>
      </div>
      <button
        className="btn btn--ghost btn--sm"
        onClick={onLeave}
        disabled={leaving}
      >
        {leaving ? 'Leaving…' : 'Leave'}
      </button>
    </header>
  );
}

function ParticipantList({ participants }: { participants: Participant[] }) {
  return (
    <section className="participants-panel" aria-label="Participants">
      <h2 className="panel-heading">People</h2>
      <ul className="participant-list" role="list">
        {participants.map((p) => (
          <li key={p.id} className="participant-item">
            <span className="participant-role-icon" aria-label={p.role === 'HOST' ? 'Host' : 'Member'}>
              {p.role === 'HOST' ? '👑' : '\u00a0\u00a0\u00a0\u00a0'}
            </span>
            <span className="participant-name">{p.displayName}</span>
            {p.isOnline === false && (
              <span className="participant-offline" title="Disconnected" aria-label="offline">○</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function JoinRequestBanner({
  requests,
  roomId,
  participantId,
  onResolved,
}: {
  requests: PendingJoinRequest[];
  roomId: string;
  participantId: string;
  onResolved: (requestId: string) => void;
}) {
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  const handle = useCallback(
    async (req: PendingJoinRequest, action: 'ACCEPT' | 'REJECT') => {
      setBusy((b) => ({ ...b, [req.id]: true }));
      try {
        await resolveJoinRequest(roomId, req.id, action, participantId);
        onResolved(req.id);
      } catch (err) {
        console.error('[join-request] resolve failed', err);
      } finally {
        setBusy((b) => ({ ...b, [req.id]: false }));
      }
    },
    [roomId, participantId, onResolved],
  );

  if (requests.length === 0) return null;

  return (
    <div className="join-request-stack" role="region" aria-label="Join requests">
      {requests.map((req) => (
        <div key={req.id} className="join-request-banner">
          <span className="join-request-name">
            <strong>{req.displayName}</strong> wants to join
          </span>
          <div className="join-request-actions">
            <button
              className="btn btn--accept btn--sm"
              onClick={() => void handle(req, 'ACCEPT')}
              disabled={busy[req.id]}
            >
              Accept
            </button>
            <button
              className="btn btn--reject btn--sm"
              onClick={() => void handle(req, 'REJECT')}
              disabled={busy[req.id]}
            >
              Reject
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page states
// ---------------------------------------------------------------------------

type PageStatus = 'resolving' | 'ready' | 'error' | 'closed';

const INITIAL_PLAYER_STATE: PlayerState = {
  status: 'idle',
  song: null,
  positionSecs: 0,
  durationSecs: 0,
  volume: 0.8,
  queueIndex: -1,
};

// ---------------------------------------------------------------------------
// RoomPage
// ---------------------------------------------------------------------------

export function RoomPage() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();

  const [pageStatus, setPageStatus] = useState<PageStatus>('resolving');
  const [errorMsg, setErrorMsg] = useState('');
  const [identity, setIdentity] = useState<LocalParticipant | null>(null);

  // Host-side pending requests that were loaded at hydration time (before WS).
  // The WS hook owns them after that — we seed them into roomState via the
  // hydration effect below.
  const [hydratedPendingRequests, setHydratedPendingRequests] = useState<
    PendingJoinRequest[]
  >([]);

  const [leaving, setLeaving] = useState(false);

  // AudioPlayer (Phase 5 — idle; wired to room in Phase 6)
  const [playerState, setPlayerState] = useState<PlayerState>(INITIAL_PLAYER_STATE);
  const playerRef = useRef<AudioPlayer | null>(null);

  useEffect(() => {
    const player = new AudioPlayer((state) => setPlayerState(state));
    player.setVolume(INITIAL_PLAYER_STATE.volume);
    playerRef.current = player;
    return () => {
      player.destroy();
      playerRef.current = null;
    };
  }, []);

  // ── 1. Identity resolution ────────────────────────────────────────────────
  useEffect(() => {
    if (!code) {
      setErrorMsg('Invalid room link.');
      setPageStatus('error');
      return;
    }

    // Both creator and joiner store their identity under 'participant' before
    // navigating here. The ?joining=1 flag is informational only.
    const stored = readStoredParticipant();
    if (stored && stored.roomCode === code) {
      setIdentity(stored);
      setPageStatus('ready');
      return;
    }

    setErrorMsg('No session found for this room. Please create or join a room first.');
    setPageStatus('error');
  }, [code]);

  // ── 2. Room hydration (fetch initial state before WS connects) ────────────
  useEffect(() => {
    if (pageStatus !== 'ready' || !identity) return;

    const hydrate = async () => {
      try {
        const data = await getRoomDetail(identity.roomId, identity.id);
        const room = data.room;
        // Patch identity if role changed server-side (e.g. host transfer)
        const selfParticipant = room.participants.find((p) => p.id === identity.id);
        if (selfParticipant && selfParticipant.role !== identity.role) {
          const updated = { ...identity, role: selfParticipant.role };
          setIdentity(updated);
          sessionStorage.setItem('participant', JSON.stringify(updated));
        }
        // Seed pending join requests for HOST
        if (room.pendingJoinRequests) {
          setHydratedPendingRequests(room.pendingJoinRequests);
        }
      } catch (err) {
        // Non-fatal — WS will provide current state on connect
        console.warn('[room] hydration failed', err);
      }
    };

    void hydrate();
  }, [pageStatus, identity]);

  // ── 3. WebSocket ──────────────────────────────────────────────────────────
  const handleFatalClose = useCallback(
    (reason: string) => {
      setErrorMsg(reason);
      setPageStatus('closed');
    },
    [],
  );

  const { roomState, socketStatus } = useRoomSocket(
    pageStatus === 'ready' && identity
      ? { roomId: identity.roomId, participantId: identity.id, onFatalClose: handleFatalClose }
      : { roomId: '', participantId: '', onFatalClose: handleFatalClose },
  );

  // Merge hydrated pending requests into the WS state on first ROOM_STATE.
  // The WS hook doesn't know about hydrated requests until a JOIN_REQUEST
  // event arrives. We seed them once here so the UI shows them immediately.
  const [pendingSeeded, setPendingSeeded] = useState(false);
  useEffect(() => {
    if (!pendingSeeded && roomState.roomId && hydratedPendingRequests.length > 0) {
      // The WS reducer will accumulate future JOIN_REQUEST events.
      // For already-pending requests we hold them in local state and merge
      // for display — removing them when the WS JOIN_REQUEST_RESOLVED fires.
      setPendingSeeded(true);
    }
  }, [pendingSeeded, roomState.roomId, hydratedPendingRequests]);

  // Merge hydrated + WS pending requests, deduplicated by id.
  const mergedPendingRequests = (() => {
    const wsIds = new Set(roomState.pendingJoinRequests.map((r) => r.id));
    const extra = hydratedPendingRequests.filter((r) => !wsIds.has(r.id));
    return [...extra, ...roomState.pendingJoinRequests];
  })();

  // When a request is resolved via button click (before WS echo), remove it
  // from the hydrated list too.
  const handleResolved = useCallback((requestId: string) => {
    setHydratedPendingRequests((prev) => prev.filter((r) => r.id !== requestId));
  }, []);

  // ── 4. Leave ──────────────────────────────────────────────────────────────
  const handleLeave = useCallback(async () => {
    if (!identity) return;
    setLeaving(true);
    try {
      await leaveRoom(identity.roomId, identity.id);
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 409)) {
        // 409 ALREADY_LEFT is fine — just navigate away
        console.warn('[room] leave failed', err);
      }
    } finally {
      sessionStorage.removeItem('participant');
      void navigate('/');
    }
  }, [identity, navigate]);

  // ── Render states ──────────────────────────────────────────────────────────

  if (pageStatus === 'resolving') {
    return (
      <div className="room-loading">
        <div className="waiting-spinner" aria-hidden="true" />
        <p>Loading room…</p>
      </div>
    );
  }

  if (pageStatus === 'error' || pageStatus === 'closed') {
    return (
      <div className="room-loading">
        <p className="room-error-msg">{errorMsg || 'Something went wrong.'}</p>
        <button className="btn btn--primary" onClick={() => void navigate('/')}>
          Back to Home
        </button>
      </div>
    );
  }

  // pageStatus === 'ready'
  const participants =
    roomState.participants.length > 0
      ? roomState.participants
      : (identity ? [{ id: identity.id, displayName: identity.displayName, role: identity.role }] : []);

  const isHost = identity?.role === 'HOST';

  return (
    <div className="app">
      <RoomHeader
        code={code ?? ''}
        onLeave={() => void handleLeave()}
        leaving={leaving}
      />

      {isHost && identity && (
        <JoinRequestBanner
          requests={mergedPendingRequests}
          roomId={identity.roomId}
          participantId={identity.id}
          onResolved={handleResolved}
        />
      )}

      <main className="room-main">
        <div className="room-content">
          {/* Player area — wired in Phase 6 */}
          <section className="room-player-area">
            {socketStatus === 'connecting' && (
              <div className="room-connecting">
                <div className="waiting-spinner" aria-hidden="true" />
                <span>Connecting…</span>
              </div>
            )}
            {socketStatus !== 'connecting' && (
              <div className="room-player-placeholder">
                <p className="room-player-hint">
                  {roomState.playback.currentSongId
                    ? 'Music player active — Phase 6 will sync playback here.'
                    : 'No song playing yet.'}
                </p>
              </div>
            )}
          </section>

          <ParticipantList participants={participants} />
        </div>
      </main>

      <PlayerBar
        state={playerState}
        onPlay={() => playerRef.current?.play()}
        onPause={() => playerRef.current?.pause()}
        onSeek={(s) => playerRef.current?.seek(s)}
        onNext={() => playerRef.current?.next()}
        onPrevious={() => playerRef.current?.previous()}
        onVolumeChange={(v) => playerRef.current?.setVolume(v)}
      />
    </div>
  );
}
