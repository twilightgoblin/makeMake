// -----------------------------------------------------------------------------
// Makemake — RoomPage  (iPod redesign)
//
// Layout:
//   Desktop: [RoomPanel (social)] | [iPod centred in remaining space]
//   Mobile:  iPod fills screen + floating button → slide-in drawer
//
// Audio engine, WebSocket, drift-correction and all server interactions are
// unchanged from the previous implementation. Only the visual layer is new.
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
  leaveRoom,
  fetchPlaylist,
  fetchMessages,
  addToPlaylist,
  computeLivePosition,
  ApiError,
  type PlaylistEntry,
} from '../lib/api';
import { useRoomSocket } from '../lib/useRoomSocket';
import type { ChatMessageRecord } from '../lib/useRoomSocket';
import { AudioPlayer } from '../lib/AudioPlayer';
import { IPod } from '../components/ipod/IPod';
import { RoomPanel, FloatingJoinRequests } from '../components/room/RoomPanel';
import type { ChatMessage } from '../components/room/RoomPanel';
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

function wsMessageToChatMessage(m: ChatMessageRecord): ChatMessage {
  return {
    id: m.id,
    senderName: m.sender.displayName,
    senderId: m.sender.id,
    content: m.content,
    sentAt: m.sentAt,
  };
}

// ---------------------------------------------------------------------------
// RoomPage
// ---------------------------------------------------------------------------

type PageStatus = 'resolving' | 'ready' | 'error' | 'closed';

export function RoomPage() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();

  const [pageStatus, setPageStatus] = useState<PageStatus>(code ? 'resolving' : 'error');
  const [errorMsg, setErrorMsg] = useState(code ? '' : 'Invalid room link.');
  const [identity, setIdentity] = useState<LocalParticipant | null>(null);
  const [hydratedPendingRequests, setHydratedPendingRequests] = useState<PendingJoinRequest[]>([]);
  const [leaving, setLeaving] = useState(false);
  const [closing, setClosing] = useState(false);
  const [, setAddingId] = useState<string | null>(null);

  // Mobile drawer state
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [lastSeenRequestCount, setLastSeenRequestCount] = useState(0);
  const [lastSeenMessageCount, setLastSeenMessageCount] = useState(0);

  // ── AudioPlayer ────────────────────────────────────────────────────────────
  const [playerState, setPlayerState] = useState<PlayerState>(INITIAL_PLAYER_STATE);
  const playerRef = useRef<AudioPlayer | null>(null);

  useEffect(() => {
    const player = new AudioPlayer((state) => setPlayerState(state));
    player.setVolume(INITIAL_PLAYER_STATE.volume);
    player.roomMode = true;
    playerRef.current = player;
    return () => {
      player.destroy();
      playerRef.current = null;
    };
  }, []);

  // ── Playlist ref for resolveSong ──────────────────────────────────────────
  const playlistRef = useRef<PlaylistEntry[]>([]);
  const resolveSong = useCallback(
    (songId: string): Song | undefined =>
      playlistRef.current.find((e) => e.song.id === songId)?.song,
    [],
  );

  // ── 1. Identity resolution ────────────────────────────────────────────────
  useEffect(() => {
    if (!code) return;
    const stored = readStoredParticipant();
    if (stored && stored.roomCode === code) {
      setIdentity(stored);
      setPageStatus('ready');
      return;
    }
    setErrorMsg('No session found for this room. Please create or join a room first.');
    setPageStatus('error');
  }, [code]);

  // ── 2. Room hydration ─────────────────────────────────────────────────────
  useEffect(() => {
    if (pageStatus !== 'ready' || !identity) return;
    const hydrate = async () => {
      try {
        const data = await getRoomDetail(identity.roomId, identity.id);
        const room = data.room;
        const selfParticipant = room.participants.find((p) => p.id === identity.id);
        if (selfParticipant && selfParticipant.role !== identity.role) {
          const updated = { ...identity, role: selfParticipant.role };
          setIdentity(updated);
          sessionStorage.setItem('participant', JSON.stringify(updated));
        }
        if (room.pendingJoinRequests) setHydratedPendingRequests(room.pendingJoinRequests);
      } catch (err) {
        console.warn('[room] hydration failed', err);
      }
    };
    void hydrate();
  }, [pageStatus, identity]);

  // ── 3. Playlist fetch ─────────────────────────────────────────────────────
  const seedPlaylistRef = useRef<((entries: PlaylistEntry[]) => void) | null>(null);
  useEffect(() => {
    if (pageStatus !== 'ready' || !identity) return;
    const load = async () => {
      try {
        const data = await fetchPlaylist(identity.roomId, identity.id);
        seedPlaylistRef.current?.(data.playlist);
      } catch (err) {
        console.warn('[room] playlist fetch failed', err);
      }
    };
    void load();
  }, [pageStatus, identity]);

  // ── 3b. Chat history fetch ────────────────────────────────────────────────
  const seedMessagesRef = useRef<((msgs: import('../lib/useRoomSocket').ChatMessageRecord[]) => void) | null>(null);
  useEffect(() => {
    if (pageStatus !== 'ready' || !identity) return;
    const load = async () => {
      try {
        const data = await fetchMessages(identity.roomId, identity.id);
        seedMessagesRef.current?.(data.messages);
      } catch (err) {
        console.warn('[room] message history fetch failed', err);
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

  const { roomState, socketStatus, send, livePlayback, seedPlaylist, seedMessages, isHydrated } = useRoomSocket(
    isReady
      ? { roomId: identity!.roomId, participantId: identity!.id, onFatalClose: handleFatalClose, resolveSong }
      : { roomId: '', participantId: '', onFatalClose: handleFatalClose, resolveSong },
  );

  useEffect(() => {
    seedPlaylistRef.current = seedPlaylist;
  }, [seedPlaylist]);
  useEffect(() => {
    seedMessagesRef.current = seedMessages;
  }, [seedMessages]);
  useEffect(() => {
    playlistRef.current = roomState.playlist;
  }, [roomState.playlist]);

  // ── 5. Song loading ───────────────────────────────────────────────────────
  const lastLoadedSongIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isHydrated) return;
    const player = playerRef.current;
    if (!player) return;
    const { currentSong, isPlaying, positionSecs, stateUpdatedAt } = livePlayback;
    if (!currentSong) {
      if (lastLoadedSongIdRef.current !== null) { player.pause(); lastLoadedSongIdRef.current = null; }
      return;
    }
    if (currentSong.id === lastLoadedSongIdRef.current) {
      player.syncTo(computeLivePosition({ currentSong, isPlaying, positionSecs, stateUpdatedAt }), isPlaying);
      return;
    }
    lastLoadedSongIdRef.current = currentSong.id;
    player.loadSong(currentSong, computeLivePosition({ currentSong, isPlaying, positionSecs, stateUpdatedAt }), isPlaying);
  }, [isHydrated, livePlayback.currentSong?.id, livePlayback.isPlaying, livePlayback.positionSecs, livePlayback.stateUpdatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 6. Drift correction ───────────────────────────────────────────────────
  useEffect(() => {
    if (!isHydrated || !livePlayback.isPlaying || !livePlayback.currentSong) return;
    const id = setInterval(() => {
      const player = playerRef.current;
      if (!player) return;
      const state = player.getState();
      const expected = computeLivePosition(livePlayback);
      
      // If room is playing but local player is paused (e.g. browser autoplay block), force play
      if (state.status !== 'playing' && state.status !== 'loading') {
        player.syncTo(expected, true);
        return;
      }
      
      if (state.status !== 'playing') return;
      
      if (Math.abs(state.positionSecs - expected) > DRIFT_THRESHOLD_SECS) {
        player.syncTo(expected, true);
      }
    }, DRIFT_CHECK_INTERVAL_MS);
    return () => clearInterval(id);
  }, [livePlayback, isHydrated]);

  // ── 7. Derive isHost ──────────────────────────────────────────────────────
  const isHost = (() => {
    if (!identity) return false;
    const self = roomState.participants.find((p) => p.id === identity.id);
    return self ? self.role === 'HOST' : identity.role === 'HOST';
  })();

  // ── 8. HOST playback callbacks → WS ──────────────────────────────────────
  const handlePlay = useCallback(() => {
    if (!isHost) return;
    send('PLAY', { positionSecs: playerRef.current?.getState().positionSecs ?? 0 });
  }, [isHost, send]);

  const handlePause = useCallback(() => {
    if (!isHost) return;
    send('PAUSE', { positionSecs: playerRef.current?.getState().positionSecs ?? 0 });
  }, [isHost, send]);

  const handleSeek = useCallback((positionSecs: number) => {
    if (!isHost) return;
    send('SEEK', { positionSecs });
  }, [isHost, send]);

  const handleNext = useCallback(() => {
    if (!isHost) return;
    send('NEXT', {});
  }, [isHost, send]);

  const handlePrevious = useCallback(() => {
    if (!isHost) return;
    send('PREVIOUS', {});
  }, [isHost, send]);

  const handleVolumeChange = useCallback((v: number) => {
    playerRef.current?.setVolume(v);
  }, []);

  // ── 9. Playlist mutations ─────────────────────────────────────────────────
  const handleAddSong = useCallback(async (songId: string) => {
    if (!identity) return;
    setAddingId(songId);
    try {
      const res = await addToPlaylist(identity.roomId, songId, identity.id);
      // If HOST and no song is currently loaded, start playing the added song immediately.
      // If a song is already playing (or paused), just leave it in the playlist.
      if (isHost && !livePlayback.currentSong) {
        send('SET_SONG', { entryId: res.entry.id, play: true });
      }
    } catch (err) {
      console.error('[playlist] add failed', err);
    } finally {
      setAddingId(null);
    }
  }, [identity, isHost, livePlayback.currentSong, send]);

  const handleSetSong = useCallback((entryId: string) => {
    if (!isHost) return;
    send('SET_SONG', { entryId, play: true });
  }, [isHost, send]);

  // ── 10. Chat ──────────────────────────────────────────────────────────────
  const handleSendMessage = useCallback((content: string) => {
    if (!identity) return;
    send('CHAT_MESSAGE', { content });
  }, [identity, send]);

  const chatMessages: ChatMessage[] = roomState.messages.map(wsMessageToChatMessage);

  // ── 11. Join request merge ────────────────────────────────────────────────
  const mergedPendingRequests = (() => {
    const wsIds = new Set(roomState.pendingJoinRequests.map((r) => r.id));
    return [
      ...hydratedPendingRequests.filter((r) => !wsIds.has(r.id)),
      ...roomState.pendingJoinRequests,
    ];
  })();

  const handleRequestResolved = useCallback((requestId: string) => {
    setHydratedPendingRequests((prev) => prev.filter((r) => r.id !== requestId));
  }, []);

  // ── Track unread counts for mobile ────────────────────────────────────────
  useEffect(() => {
    if (drawerOpen) {
      setLastSeenRequestCount(mergedPendingRequests.length);
      setLastSeenMessageCount(chatMessages.length);
    }
  }, [drawerOpen, mergedPendingRequests.length, chatMessages.length]);

  const hasUnread = (isHost && mergedPendingRequests.length > lastSeenRequestCount) || (chatMessages.length > lastSeenMessageCount);

  // ── 12. Leave / Close ─────────────────────────────────────────────────────
  const handleLeave = useCallback(async () => {
    if (!identity) return;
    setLeaving(true);
    try {
      await leaveRoom(identity.roomId, identity.id);
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 409)) console.warn('[room] leave failed', err);
    } finally {
      sessionStorage.removeItem('participant');
      void navigate('/');
    }
  }, [identity, navigate]);

  const handleClose = useCallback(async () => {
    if (!identity || !isHost) return;
    setClosing(true);
    try {
      const { closeRoom } = await import('../lib/api');
      await closeRoom(identity.roomId, identity.id);
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
        <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>Loading room…</p>
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

  // ── Active room ───────────────────────────────────────────────────────────
  const participants: Participant[] =
    roomState.participants.length > 0
      ? roomState.participants
      : identity
        ? [{ id: identity.id, displayName: identity.displayName, role: identity.role }]
        : [];

  const socialPanel = identity && (
    <RoomPanel
      participants={participants}
      selfId={identity.id}
      isHost={isHost}
      roomId={identity.roomId}
      participantId={identity.id}
      onRequestResolved={handleRequestResolved}
      chatMessages={chatMessages}
      onSendMessage={handleSendMessage}
      roomCode={code ?? ''}
    />
  );

  const ipodEl = (
    <IPod
      playerState={playerState}
      onPlay={handlePlay}
      onPause={handlePause}
      onSeek={handleSeek}
      onNext={handleNext}
      onPrevious={handlePrevious}
      onVolumeChange={handleVolumeChange}
      playlist={roomState.playlist}
      onAddSong={(songId) => void handleAddSong(songId)}
      onSetSong={handleSetSong}
      isHost={isHost}
      isRoom={true}
      socketStatus={socketStatus}
    />
  );

  return (
    <div className="room-page">
      {/* Top bar */}
      <div className="room-topbar">
        <div className="room-topbar-left">
          <span className="room-wordmark">Makemake</span>
        </div>
        <div className="room-topbar-actions">
          {isHost && (
            <button
              className="btn btn--ghost btn--sm btn--danger"
              onClick={() => void handleClose()}
              disabled={closing || leaving}
            >
              {closing ? 'Closing…' : 'Close Room'}
            </button>
          )}
          <button
            className="btn btn--ghost btn--sm"
            onClick={() => void handleLeave()}
            disabled={leaving || closing}
          >
            {leaving ? 'Leaving…' : 'Leave'}
          </button>
        </div>
      </div>

      {/* Main body */}
      <div className="room-body">
        {/* Desktop: left social panel */}
        {socialPanel}

        {/* iPod zone */}
        <div className="ipod-zone" style={{ position: 'relative' }}>
          {isHost && mergedPendingRequests.length > 0 && identity && (
            <FloatingJoinRequests
              requests={mergedPendingRequests}
              roomId={identity.roomId}
              participantId={identity.id}
              onResolved={handleRequestResolved}
            />
          )}
          {ipodEl}
        </div>
      </div>

      {/* Mobile: floating button → drawer */}
      <button
        className="mobile-room-btn"
        onClick={() => setDrawerOpen(true)}
        aria-label="Open room"
        title="Open room"
      >
        {/* Users icon (Lucide-style, inline SVG) */}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          {/* Primary person */}
          <circle cx="9" cy="7" r="4" />
          <path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2" />
          {/* Secondary person (behind) */}
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
          <path d="M21 21v-2a4 4 0 0 0-3-3.85" />
        </svg>
        {hasUnread && <span className="notification-dot" aria-hidden="true" />}
      </button>

      {drawerOpen && (
        <div className="room-drawer" role="dialog" aria-modal="true" aria-label="Room panel">
          <div
            className="room-drawer-backdrop"
            onClick={() => setDrawerOpen(false)}
            aria-hidden="true"
          />
          <div className={`room-drawer-panel room-drawer-panel--open`}>
            <div className="room-drawer-header">
              <span className="room-wordmark">Room · {code}</span>
              <button
                className="room-drawer-close"
                onClick={() => setDrawerOpen(false)}
                aria-label="Close panel"
              >
                ×
              </button>
            </div>
            <div className="room-drawer-content">
              {identity && (
                <RoomPanel
                  participants={participants}
                  selfId={identity.id}
                  isHost={isHost}
                  roomId={identity.roomId}
                  participantId={identity.id}
                  onRequestResolved={handleRequestResolved}
                  chatMessages={chatMessages}
                  onSendMessage={handleSendMessage}
                  roomCode={code ?? ''}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
