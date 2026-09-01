// -----------------------------------------------------------------------------
// Makemake — RoomPage  (Phase 6: realtime sync)
//
// Responsibilities:
//   1. Identity resolution (sessionStorage 'participant' key)
//   2. Room hydration (GET /rooms/:id) — initial state before WS connects
//   3. WebSocket connection via useRoomSocket
//   4. AudioPlayer ↔ WebSocket bridge
//      - Song loads driven by roomState.playback.currentSong changes
//      - HOST PlayerBar controls send WS commands; broadcast echo applies them
//      - MEMBER AudioPlayer is entirely driven by broadcasts
//   5. Drift correction loop (5 s interval, 0.5 s threshold)
//   6. Playlist panel (fetch on mount, WS events keep it live)
// -----------------------------------------------------------------------------

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  getRoomDetail,
  resolveJoinRequest,
  leaveRoom,
  fetchPlaylist,
  addToPlaylist,
  computeLivePosition,
  ApiError,
  type PlaylistEntry,
} from '../lib/api';
import { useRoomSocket } from '../lib/useRoomSocket';
import { PlayerBar } from '../components/PlayerBar';
import { AudioPlayer } from '../lib/AudioPlayer';
import { SongLibrary } from '../components/SongLibrary';
import { formatDuration } from '../lib/formatDuration';
import type {
  LocalParticipant,
  Participant,
  PendingJoinRequest,
  PlayerState,
  Song,
} from '../types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DRIFT_CHECK_INTERVAL_MS = 5_000;
const DRIFT_THRESHOLD_SECS = 0.5;

const INITIAL_PLAYER_STATE: PlayerState = {
  status: 'idle',
  song: null,
  positionSecs: 0,
  durationSecs: 0,
  volume: 0.8,
  queueIndex: -1,
};

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
  isHost,
  onClose,
  closing,
}: {
  code: string;
  onLeave: () => void;
  leaving: boolean;
  isHost: boolean;
  onClose: () => void;
  closing: boolean;
}) {
  return (
    <header className="room-header">
      <div className="room-header-left">
        <span className="app-logo">♪</span>
        <span className="room-code">{code}</span>
      </div>
      <div className="room-header-actions">
        {isHost && (
          <button
            className="btn btn--ghost btn--sm btn--danger"
            onClick={onClose}
            disabled={closing || leaving}
            title="Close room for everyone"
          >
            {closing ? 'Closing…' : 'Close Room'}
          </button>
        )}
        <button
          className="btn btn--ghost btn--sm"
          onClick={onLeave}
          disabled={leaving || closing}
        >
          {leaving ? 'Leaving…' : 'Leave'}
        </button>
      </div>
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
            <span
              className="participant-role-icon"
              aria-label={p.role === 'HOST' ? 'Host' : 'Member'}
            >
              {p.role === 'HOST' ? '👑' : '\u00a0\u00a0\u00a0\u00a0'}
            </span>
            <span className="participant-name">{p.displayName}</span>
            {p.isOnline === false && (
              <span
                className="participant-offline"
                title="Disconnected"
                aria-label="offline"
              >
                ○
              </span>
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
// PlaylistPanel
// ---------------------------------------------------------------------------

function PlaylistPanel({
  playlist,
  currentSongId,
  participantId,
  roomId,
  onAddSong,
  addingId,
  isHost,
  onSetSong,
}: {
  playlist: PlaylistEntry[];
  currentSongId: string | null;
  participantId: string;
  roomId: string;
  onAddSong: (songId: string) => void;
  addingId: string | null;
  isHost: boolean;
  onSetSong: (entryId: string) => void;
}) {
  const [showLibrary, setShowLibrary] = useState(false);

  return (
    <section className="playlist-panel" aria-label="Playlist">
      <div className="panel-heading-row">
        <h2 className="panel-heading">Playlist</h2>
        <button
          className="btn btn--ghost btn--sm"
          onClick={() => setShowLibrary((v) => !v)}
          aria-expanded={showLibrary}
        >
          {showLibrary ? 'Done' : '+ Add'}
        </button>
      </div>

      {showLibrary && (
        <div className="playlist-add-library">
          <SongLibrary
            activeSongId={currentSongId}
            onSelect={(song) => {
              onAddSong(song.id);
              setShowLibrary(false);
            }}
          />
        </div>
      )}

      {playlist.length === 0 ? (
        <p className="playlist-empty">No songs yet. Add one above.</p>
      ) : (
        <ol className="playlist-list" aria-label="Queued songs">
          {playlist.map((entry, idx) => {
            const isActive = entry.song.id === currentSongId;
            return (
              <li
                key={entry.id}
                className={`playlist-item${isActive ? ' playlist-item--active' : ''}${isHost && !isActive ? ' playlist-item--clickable' : ''}`}
                onClick={isHost && !isActive ? () => onSetSong(entry.id) : undefined}
                title={isHost && !isActive ? `Play ${entry.song.title}` : undefined}
                role={isHost && !isActive ? 'button' : undefined}
                tabIndex={isHost && !isActive ? 0 : undefined}
                onKeyDown={isHost && !isActive ? (e) => {
                  if (e.key === 'Enter' || e.key === ' ') onSetSong(entry.id);
                } : undefined}
              >
                <span className="playlist-item-num" aria-hidden="true">
                  {isActive ? '▶' : idx + 1}
                </span>
                <img
                  className="playlist-item-cover"
                  src={entry.song.coverUrl}
                  alt=""
                  aria-hidden="true"
                  loading="lazy"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.visibility = 'hidden';
                  }}
                />
                <div className="playlist-item-meta">
                  <span className="playlist-item-title">{entry.song.title}</span>
                  <span className="playlist-item-artist">{entry.song.artist}</span>
                </div>
                <span className="playlist-item-duration">
                  {formatDuration(entry.song.duration)}
                </span>
                {addingId === entry.song.id && (
                  <span className="playlist-item-adding" aria-label="Adding…">
                    …
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Page status type
// ---------------------------------------------------------------------------

type PageStatus = 'resolving' | 'ready' | 'error' | 'closed';

// ---------------------------------------------------------------------------
// RoomPage
// ---------------------------------------------------------------------------

export function RoomPage() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();

  const [pageStatus, setPageStatus] = useState<PageStatus>('resolving');
  const [errorMsg, setErrorMsg] = useState('');
  const [identity, setIdentity] = useState<LocalParticipant | null>(null);
  const [hydratedPendingRequests, setHydratedPendingRequests] = useState<
    PendingJoinRequest[]
  >([]);
  const [leaving, setLeaving] = useState(false);
  const [closing, setClosing] = useState(false);

  // ── Playlist state ────────────────────────────────────────────────────────
  // Playlist lives in roomState.playlist (managed by useRoomSocket reducer).
  // We only need local state for the "adding" spinner.
  const [addingId, setAddingId] = useState<string | null>(null);

  // resolveSong is passed to useRoomSocket so it can resolve songIds from
  // PLAY/PAUSE/SEEK broadcasts to full Song objects. We use a ref so the
  // callback is stable (doesn't change identity on re-renders) while still
  // reading the latest playlist.
  const playlistRef = useRef<PlaylistEntry[]>([]);
  const resolveSong = useCallback(
    (songId: string): Song | undefined =>
      playlistRef.current.find((e) => e.song.id === songId)?.song,
    [],
  );

  // ── AudioPlayer ────────────────────────────────────────────────────────────
  const [playerState, setPlayerState] = useState<PlayerState>(INITIAL_PLAYER_STATE);
  const playerRef = useRef<AudioPlayer | null>(null);

  useEffect(() => {
    const player = new AudioPlayer((state) => setPlayerState(state));
    player.setVolume(INITIAL_PLAYER_STATE.volume);
    player.roomMode = true; // suppress auto-advance on 'ended'
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

    const stored = readStoredParticipant();
    if (stored && stored.roomCode === code) {
      setIdentity(stored);
      setPageStatus('ready');
      return;
    }

    setErrorMsg(
      'No session found for this room. Please create or join a room first.',
    );
    setPageStatus('error');
  }, [code]);

  // ── 2. Room hydration ─────────────────────────────────────────────────────
  useEffect(() => {
    if (pageStatus !== 'ready' || !identity) return;

    const hydrate = async () => {
      try {
        const data = await getRoomDetail(identity.roomId, identity.id);
        const room = data.room;

        const selfParticipant = room.participants.find(
          (p) => p.id === identity.id,
        );
        if (selfParticipant && selfParticipant.role !== identity.role) {
          const updated = { ...identity, role: selfParticipant.role };
          setIdentity(updated);
          sessionStorage.setItem('participant', JSON.stringify(updated));
        }
        if (room.pendingJoinRequests) {
          setHydratedPendingRequests(room.pendingJoinRequests);
        }
      } catch (err) {
        console.warn('[room] hydration failed', err);
      }
    };

    void hydrate();
  }, [pageStatus, identity]);

  // ── 3. Playlist fetch ─────────────────────────────────────────────────────
  // Seed the playlist from HTTP once on mount. After that, WS events
  // (PLAYLIST_ADD/REMOVE/REORDER) keep it live in the reducer.
  const seedPlaylistRef = useRef<((entries: PlaylistEntry[]) => void) | null>(null);

  useEffect(() => {
    if (pageStatus !== 'ready' || !identity) return;

    const load = async () => {
      try {
        const data = await fetchPlaylist(identity.roomId, identity.id);
        // seedPlaylist may not be available yet on the very first render;
        // the ref is populated right after the hook call below.
        seedPlaylistRef.current?.(data.playlist);
      } catch (err) {
        console.warn('[room] playlist fetch failed', err);
      }
    };

    void load();
  }, [pageStatus, identity]);

  // ── 4. WebSocket ──────────────────────────────────────────────────────────
  const handleFatalClose = useCallback((reason: string) => {
    setErrorMsg(reason);
    setPageStatus('closed');
  }, []);

  const isReady = pageStatus === 'ready' && identity !== null;

  const { roomState, socketStatus, send, livePlayback, seedPlaylist } = useRoomSocket(
    isReady
      ? {
          roomId: identity!.roomId,
          participantId: identity!.id,
          onFatalClose: handleFatalClose,
          resolveSong,
        }
      : {
          roomId: '',
          participantId: '',
          onFatalClose: handleFatalClose,
          resolveSong,
        },
  );

  // Wire the seed ref so the playlist HTTP fetch can call it.
  seedPlaylistRef.current = seedPlaylist;

  // Keep the playlist ref in sync so resolveSong always sees the latest entries.
  useEffect(() => {
    playlistRef.current = roomState.playlist;
  }, [roomState.playlist]);

  // ── 5. Song loading — react to playback.currentSong changes ──────────────
  const lastLoadedSongIdRef = useRef<string | null>(null);

  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;

    const { currentSong, isPlaying, positionSecs, stateUpdatedAt } =
      livePlayback;

    if (!currentSong) {
      // No song — reset player to idle
      if (lastLoadedSongIdRef.current !== null) {
        player.pause();
        lastLoadedSongIdRef.current = null;
      }
      return;
    }

    if (currentSong.id === lastLoadedSongIdRef.current) {
      // Same song — just sync play state and position
      const livePos = computeLivePosition({ currentSong, isPlaying, positionSecs, stateUpdatedAt });
      player.syncTo(livePos, isPlaying);
      return;
    }

    // New song — load it at the correct position
    lastLoadedSongIdRef.current = currentSong.id;
    const livePos = computeLivePosition({ currentSong, isPlaying, positionSecs, stateUpdatedAt });
    player.loadSong(currentSong, livePos, isPlaying);
  }, [
    // We deliberately depend only on the song id + isPlaying + position anchor
    // so that time-update ticks from the audio element don't cause re-loads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    livePlayback.currentSong?.id,
    livePlayback.isPlaying,
    livePlayback.positionSecs,
    livePlayback.stateUpdatedAt,
  ]);

  // ── 6. Drift correction loop ──────────────────────────────────────────────
  useEffect(() => {
    if (!livePlayback.isPlaying || !livePlayback.currentSong) return;

    const id = setInterval(() => {
      const player = playerRef.current;
      if (!player) return;

      const state = player.getState();
      if (state.status !== 'playing') return;

      const expected = computeLivePosition(livePlayback);
      const actual = state.positionSecs;
      const drift = Math.abs(actual - expected);

      if (drift > DRIFT_THRESHOLD_SECS) {
        player.syncTo(expected, true);
      }
    }, DRIFT_CHECK_INTERVAL_MS);

    return () => clearInterval(id);
  }, [livePlayback]);

  // ── 7. HOST PlayerBar → WS commands ──────────────────────────────────────
  //
  // Derive isHost from the live roomState so HOST_CHANGED events are reflected
  // immediately without requiring a refresh. Fall back to identity.role while
  // ROOM_STATE hasn't arrived yet (socketStatus === 'connecting').
  const isHost = (() => {
    if (!identity) return false;
    const self = roomState.participants.find((p) => p.id === identity.id);
    // If we have live WS state, trust it; otherwise fall back to stored role.
    return self ? self.role === 'HOST' : identity.role === 'HOST';
  })();

  const handlePlay = useCallback(() => {
    if (!isHost) return;
    const pos = playerRef.current?.getState().positionSecs ?? 0;
    send('PLAY', { positionSecs: pos });
  }, [isHost, send]);

  const handlePause = useCallback(() => {
    if (!isHost) return;
    const pos = playerRef.current?.getState().positionSecs ?? 0;
    send('PAUSE', { positionSecs: pos });
  }, [isHost, send]);

  const handleSeek = useCallback(
    (positionSecs: number) => {
      if (!isHost) return;
      send('SEEK', { positionSecs });
    },
    [isHost, send],
  );

  const handleNext = useCallback(() => {
    if (!isHost) return;
    send('NEXT', {});
  }, [isHost, send]);

  const handlePrevious = useCallback(() => {
    if (!isHost) return;
    send('PREVIOUS', {});
  }, [isHost, send]);

  // MEMBER volume changes are purely local (volume isn't a synced property).
  const handleVolumeChange = useCallback((v: number) => {
    playerRef.current?.setVolume(v);
  }, []);

  // ── 8. Add song to playlist ───────────────────────────────────────────────
  // We send via HTTP (addToPlaylist). The server then broadcasts PLAYLIST_ADD
  // over WS to all clients including us — the reducer handles the update.
  // No re-fetch needed.
  const handleAddSong = useCallback(
    async (songId: string) => {
      if (!identity) return;
      setAddingId(songId);
      try {
        await addToPlaylist(identity.roomId, songId, identity.id);
        // The PLAYLIST_ADD WS broadcast will update roomState.playlist.
      } catch (err) {
        console.error('[playlist] add failed', err);
      } finally {
        setAddingId(null);
      }
    },
    [identity],
  );

  // HOST jumps directly to a specific playlist entry.
  const handleSetSong = useCallback(
    (entryId: string) => {
      if (!isHost) return;
      send('SET_SONG', { entryId });
    },
    [isHost, send],
  );

  // ── Merge hydrated + WS pending requests ─────────────────────────────────
  const mergedPendingRequests = (() => {
    const wsIds = new Set(roomState.pendingJoinRequests.map((r) => r.id));
    const extra = hydratedPendingRequests.filter((r) => !wsIds.has(r.id));
    return [...extra, ...roomState.pendingJoinRequests];
  })();

  const handleResolved = useCallback((requestId: string) => {
    setHydratedPendingRequests((prev) => prev.filter((r) => r.id !== requestId));
  }, []);

  // ── Leave / Close ─────────────────────────────────────────────────────────
  const handleLeave = useCallback(async () => {
    if (!identity) return;
    setLeaving(true);
    try {
      await leaveRoom(identity.roomId, identity.id);
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 409)) {
        console.warn('[room] leave failed', err);
      }
    } finally {
      sessionStorage.removeItem('participant');
      void navigate('/');
    }
  }, [identity, navigate]);

  const handleClose = useCallback(async () => {
    if (!identity || !isHost) return;
    setClosing(true);
    try {
      // Import closeRoom lazily to keep the import list clean
      const { closeRoom } = await import('../lib/api');
      await closeRoom(identity.roomId, identity.id);
      // The ROOM_CLOSED WS broadcast will call onFatalClose → setPageStatus('closed')
    } catch (err) {
      console.error('[room] close failed', err);
      setClosing(false);
    }
  }, [identity, isHost]);

  // ── Render states ─────────────────────────────────────────────────────────

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
        <button
          className="btn btn--primary"
          onClick={() => void navigate('/')}
        >
          Back to Home
        </button>
      </div>
    );
  }

  // pageStatus === 'ready'
  const participants =
    roomState.participants.length > 0
      ? roomState.participants
      : identity
        ? [
            {
              id: identity.id,
              displayName: identity.displayName,
              role: identity.role,
            },
          ]
        : [];

  const currentSongId = livePlayback.currentSong?.id ?? null;

  return (
    <div className="app">
      <RoomHeader
        code={code ?? ''}
        onLeave={() => void handleLeave()}
        leaving={leaving}
        isHost={isHost}
        onClose={() => void handleClose()}
        closing={closing}
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
          {/* Now-playing section */}
          <section className="room-player-area">
            {socketStatus === 'connecting' && (
              <div className="room-connecting">
                <div className="waiting-spinner" aria-hidden="true" />
                <span>Connecting…</span>
              </div>
            )}

            {socketStatus !== 'connecting' && (
              <>
                {livePlayback.currentSong ? (
                  <div className="room-now-playing">
                    <img
                      className="room-now-playing-cover"
                      src={livePlayback.currentSong.coverUrl}
                      alt={`Cover for ${livePlayback.currentSong.title}`}
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.visibility =
                          'hidden';
                      }}
                    />
                    <div className="room-now-playing-meta">
                      <p className="room-now-playing-title">
                        {livePlayback.currentSong.title}
                      </p>
                      <p className="room-now-playing-artist">
                        {livePlayback.currentSong.artist}
                      </p>
                    </div>
                    {!isHost && (
                      <p className="room-member-hint">
                        Playback is controlled by the host.
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="room-player-placeholder">
                    <p className="room-player-hint">
                      {isHost
                        ? 'Add a song to the playlist to start playing.'
                        : 'Waiting for the host to start music.'}
                    </p>
                  </div>
                )}
              </>
            )}
          </section>

          {/* Playlist panel */}
          {identity && (
            <PlaylistPanel
              playlist={roomState.playlist}
              currentSongId={currentSongId}
              participantId={identity.id}
              roomId={identity.roomId}
              onAddSong={(id) => void handleAddSong(id)}
              addingId={addingId}
              isHost={isHost}
              onSetSong={handleSetSong}
            />
          )}

          <ParticipantList participants={participants} />
        </div>
      </main>

      <PlayerBar
        state={playerState}
        onPlay={handlePlay}
        onPause={handlePause}
        onSeek={handleSeek}
        onNext={handleNext}
        onPrevious={handlePrevious}
        onVolumeChange={handleVolumeChange}
        controlsLocked={!isHost}
      />
    </div>
  );
}
