// -----------------------------------------------------------------------------
// IPod — the main iPod component
//
// Owns the screen view state and all navigation logic. Bridges between:
//   - ClickWheel gestures → navigation + playback
//   - IPodScreen views (menu, nowPlaying, playlist, songs, info)
//   - AudioPlayer callbacks (play/pause/seek/next/prev/volume)
//   - Song library fetch (for songs view)
//
// Props:
//   playerState   — current AudioPlayer state snapshot
//   onPlay/onPause/onSeek/onNext/onPrevious/onVolumeChange
//                 — AudioPlayer control callbacks (pass undefined for no-ops)
//   playlist      — room playlist (empty in solo mode)
//   onAddSong     — add a song to the room playlist (room only)
//   onSetSong     — HOST: jump to playlist entry (room only)
//   isHost        — controls which actions are enabled
//   isRoom        — toggles room vs solo menu items
//   socketStatus  — WebSocket status indicator (room only)
// -----------------------------------------------------------------------------

import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
} from 'react';
import type { Song, PlayerState } from '../../types';
import type { PlaylistEntry } from '../../lib/api';
import { fetchSongs } from '../../lib/api';
import { attachScreenSwipe, type SwipeDirection } from './gestures';
import { ClickWheel } from './ClickWheel';
import {
  IPodScreen,
  MAIN_MENU,
  SOLO_MENU,
  type ScreenView,
  type MenuItem,
} from './IPodScreen';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface IPodProps {
  playerState: PlayerState;
  onPlay?: () => void;
  onPause?: () => void;
  onSeek?: (secs: number) => void;
  onNext?: () => void;
  onPrevious?: () => void;
  onVolumeChange?: (vol: number) => void;
  playlist?: PlaylistEntry[];
  onAddSong?: (songId: string) => void;
  onSetSong?: (entryId: string) => void;
  /**
   * Solo mode only: called when user selects a song from the song browser.
   * Receives the song and the full songs[] array as a queue so the parent
   * can call player.loadQueue(queue, index).
   */
  onSoloSongSelect?: (song: Song, queue: Song[], index: number) => void;
  isHost?: boolean;
  isRoom?: boolean;
  socketStatus?: 'connecting' | 'open' | 'closed' | 'error';
}

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

interface IPodState {
  view: ScreenView;
  /** View to go back to when MENU is pressed */
  backStack: ScreenView[];
  menuIndex: number;
  playlistIndex: number;
  songIndex: number;
  volume: number;
}

type IPodAction =
  | { type: 'NAVIGATE'; to: ScreenView }
  | { type: 'BACK' }
  | { type: 'ROTATE'; delta: number; listLength: number }
  | { type: 'SET_VOLUME'; volume: number }
  | { type: 'RESET_INDEX'; which: 'menu' | 'playlist' | 'song' };

function clamp(val: number, min: number, max: number) {
  return Math.max(min, Math.min(max, val));
}

function getListLength(state: IPodState, menuItems: MenuItem[], playlistLen: number, songsLen: number) {
  switch (state.view) {
    case 'menu': return menuItems.length;
    case 'playlist': return playlistLen;
    case 'songs': return songsLen;
    default: return 0;
  }
}

function ipodReducer(state: IPodState, action: IPodAction): IPodState {
  switch (action.type) {
    case 'NAVIGATE':
      return {
        ...state,
        view: action.to,
        backStack: [...state.backStack, state.view],
      };

    case 'BACK': {
      if (state.backStack.length === 0) return state;
      const stack = [...state.backStack];
      const prev = stack.pop()!;
      return { ...state, view: prev, backStack: stack };
    }

    case 'ROTATE': {
      const len = action.listLength;
      if (len <= 0) {
        // In nowPlaying / info: rotate controls volume
        return state;
      }
      const field: keyof IPodState =
        state.view === 'menu'
          ? 'menuIndex'
          : state.view === 'playlist'
            ? 'playlistIndex'
            : 'songIndex';
      const current = state[field] as number;
      const next = clamp(current + action.delta, 0, len - 1);
      return { ...state, [field]: next };
    }

    case 'SET_VOLUME':
      return { ...state, volume: action.volume };

    case 'RESET_INDEX':
      if (action.which === 'playlist') return { ...state, playlistIndex: 0 };
      if (action.which === 'song') return { ...state, songIndex: 0 };
      return { ...state, menuIndex: 0 };

    default:
      return state;
  }
}

const INITIAL_STATE: IPodState = {
  view: 'nowPlaying',
  backStack: [],
  menuIndex: 0,
  playlistIndex: 0,
  songIndex: 0,
  volume: 0.8,
};

// ---------------------------------------------------------------------------
// Songs fetch hook
// ---------------------------------------------------------------------------

function useSongLibrary() {
  const [songs, setSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState(false);
  const loadedRef = useRef(false);

  const load = useCallback(async () => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    setLoading(true);
    try {
      const data = await fetchSongs({ limit: 200 });
      setSongs(data.songs);
    } catch {
      loadedRef.current = false; // allow retry
    } finally {
      setLoading(false);
    }
  }, []);

  return { songs, loading, load };
}

// ---------------------------------------------------------------------------
// IPod
// ---------------------------------------------------------------------------

export function IPod({
  playerState,
  onPlay,
  onPause,
  // onSeek is intentionally not used by the iPod directly;
  // seeking is handled via the AudioPlayer syncTo path in the room.
  onNext,
  onPrevious,
  onVolumeChange,
  playlist = [],
  onAddSong,
  onSetSong,
  onSoloSongSelect,
  isHost = true,
  isRoom = false,
  socketStatus,
}: IPodProps) {
  const [state, dispatch] = useReducer(ipodReducer, INITIAL_STATE);
  const screenRef = useRef<HTMLDivElement>(null);
  const { songs, loading: songsLoading, load: loadSongs } = useSongLibrary();

  // Stable volume ref for wheel rotation
  const volumeRef = useRef(state.volume);
  volumeRef.current = state.volume;

  const menuItems = isRoom ? MAIN_MENU : SOLO_MENU;

  // ---------------------------------------------------------------------------
  // Navigation helpers
  // ---------------------------------------------------------------------------

  const navigateTo = useCallback((view: ScreenView) => {
    if (view === 'songs') loadSongs();
    dispatch({ type: 'NAVIGATE', to: view });
  }, [loadSongs]);

  const goBack = useCallback(() => {
    dispatch({ type: 'BACK' });
  }, []);

  // ---------------------------------------------------------------------------
  // Swipe gestures on the screen
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const el = screenRef.current;
    if (!el) return;

    const cleanup = attachScreenSwipe(el, {
      onSwipe: (dir: SwipeDirection) => {
        switch (dir) {
          case 'right':
          case 'down':
            goBack();
            break;
          case 'left':
            // swipe left → next song (if in nowPlaying)
            if (state.view === 'nowPlaying') {
              if (isHost) onNext?.();
            }
            break;
          case 'up':
            // swipe up → show song info (if in nowPlaying)
            if (state.view === 'nowPlaying' && playerState.song) {
              navigateTo('info');
            }
            break;
        }
      },
    });

    return cleanup;
  }, [state.view, goBack, navigateTo, onNext, isHost, playerState.song]);

  // ---------------------------------------------------------------------------
  // Wheel rotation
  // ---------------------------------------------------------------------------

  const handleRotate = useCallback((delta: number) => {
    const listLen = getListLength(state, menuItems, playlist.length, songs.length);

    if (listLen > 0) {
      dispatch({ type: 'ROTATE', delta, listLength: listLen });
    } else {
      // In nowPlaying / info → control volume
      const newVol = clamp(volumeRef.current - delta * 0.05, 0, 1);
      volumeRef.current = newVol;
      dispatch({ type: 'SET_VOLUME', volume: newVol });
      onVolumeChange?.(newVol);
    }
  }, [state, menuItems, playlist.length, songs.length, onVolumeChange]);

  // ---------------------------------------------------------------------------
  // Center button (SELECT)
  // ---------------------------------------------------------------------------

  const handleCenterClick = useCallback(() => {
    switch (state.view) {
      case 'menu': {
        const item = menuItems[state.menuIndex];
        if (item) {
          navigateTo(item.target);
        }
        break;
      }
      case 'playlist': {
        const entry = playlist[state.playlistIndex];
        if (entry && isHost) {
          onSetSong?.(entry.id);
          navigateTo('nowPlaying');
        }
        break;
      }
      case 'songs': {
        const song = songs[state.songIndex];
        if (song) {
          if (isRoom) {
            onAddSong?.(song.id);
          } else {
            // Solo: start playing from this song
            // We load a queue of all fetched songs starting at songIndex
            // The parent gets the song via onSongSelect proxy below
          }
        }
        break;
      }
      case 'nowPlaying':
        // Center click in nowPlaying = play/pause
        if (isHost || !isRoom) {
          if (playerState.status === 'playing') {
            onPause?.();
          } else {
            onPlay?.();
          }
        }
        break;
      default:
        break;
    }
  }, [
    state,
    menuItems,
    playlist,
    songs,
    isHost,
    isRoom,
    playerState.status,
    navigateTo,
    onSetSong,
    onAddSong,
    onPlay,
    onPause,
  ]);

  // ---------------------------------------------------------------------------
  // MENU button → go back (or open menu if already at nowPlaying)
  // ---------------------------------------------------------------------------

  const handleMenuClick = useCallback(() => {
    if (state.backStack.length > 0) {
      goBack();
    } else {
      // At the root — toggle to menu
      if (state.view === 'menu') {
        navigateTo('nowPlaying');
      } else {
        navigateTo('menu');
      }
    }
  }, [state.backStack.length, state.view, goBack, navigateTo]);

  // ---------------------------------------------------------------------------
  // ⏮ / ⏭ buttons
  // ---------------------------------------------------------------------------

  const handlePrev = useCallback(() => {
    if (!isHost && isRoom) return;
    if (state.view === 'nowPlaying') {
      onPrevious?.();
    } else {
      // In list views, jump to previous item
      dispatch({ type: 'ROTATE', delta: -1, listLength: getListLength(state, menuItems, playlist.length, songs.length) });
    }
  }, [isHost, isRoom, state, menuItems, playlist.length, songs.length, onPrevious]);

  const handleNext = useCallback(() => {
    if (!isHost && isRoom) return;
    if (state.view === 'nowPlaying') {
      onNext?.();
    } else {
      dispatch({ type: 'ROTATE', delta: 1, listLength: getListLength(state, menuItems, playlist.length, songs.length) });
    }
  }, [isHost, isRoom, state, menuItems, playlist.length, songs.length, onNext]);

  // ▶/❚❚ button
  const handlePlayPause = useCallback(() => {
    if (!isHost && isRoom) return;
    if (playerState.status === 'playing') {
      onPause?.();
    } else {
      onPlay?.();
    }
  }, [isHost, isRoom, playerState.status, onPause, onPlay]);

  // ---------------------------------------------------------------------------
  // Screen callbacks (tapping items directly)
  // ---------------------------------------------------------------------------

  const handleMenuSelect = useCallback((item: MenuItem) => {
    navigateTo(item.target);
  }, [navigateTo]);

  const handlePlaylistSelect = useCallback((entry: PlaylistEntry, index: number) => {
    dispatch({ type: 'ROTATE', delta: index - state.playlistIndex, listLength: playlist.length });
    if (isHost) {
      onSetSong?.(entry.id);
      navigateTo('nowPlaying');
    }
  }, [state.playlistIndex, playlist.length, isHost, onSetSong, navigateTo]);

  // Song selection in songs view — works differently for room vs solo
  const handleSongSelect = useCallback((song: Song, index: number) => {
    dispatch({ type: 'ROTATE', delta: index - state.songIndex, listLength: songs.length });
    if (isRoom) {
      onAddSong?.(song.id);
    } else {
      // Solo: pass the full songs queue to the parent so it can loadQueue
      onSoloSongSelect?.(song, songs, index);
    }
  }, [state.songIndex, songs, isRoom, onAddSong, onSoloSongSelect]);

  // ---------------------------------------------------------------------------
  // Auto-navigate to nowPlaying when a song starts
  // ---------------------------------------------------------------------------

  const prevSongId = useRef<string | null>(null);
  useEffect(() => {
    const newId = playerState.song?.id ?? null;
    if (newId && newId !== prevSongId.current) {
      prevSongId.current = newId;
      if (state.view !== 'nowPlaying' && state.view !== 'info') {
        navigateTo('nowPlaying');
      }
    }
  }, [playerState.song?.id, state.view, navigateTo]);

  // ---------------------------------------------------------------------------
  // Expose songs for solo page's onSelect bridge
  // ---------------------------------------------------------------------------
  // (solo SoloPage doesn't need this; songs view calls onPlay directly)

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="ipod" aria-label="iPod music player">
      {/* Notch */}
      <div className="ipod-notch" aria-hidden="true" />

      {/* Screen */}
      <div className="ipod-screen-bezel">
        <div
          className="ipod-screen"
          ref={screenRef}
          role="region"
          aria-label="iPod screen"
        >
          <IPodScreen
            view={state.view}
            playerState={playerState}
            menuIndex={state.menuIndex}
            playlistIndex={state.playlistIndex}
            songIndex={state.songIndex}
            playlist={playlist}
            songs={songs}
            songsLoading={songsLoading}
            isHost={isHost}
            isRoom={isRoom}
            socketStatus={socketStatus}
            onMenuSelect={handleMenuSelect}
            onPlaylistSelect={handlePlaylistSelect}
            onSongSelect={handleSongSelect}
          />
        </div>
      </div>

      <div className="ipod-body-space" aria-hidden="true" />

      {/* Click Wheel */}
      <ClickWheel
        onRotate={handleRotate}
        onCenterClick={handleCenterClick}
        onMenuClick={handleMenuClick}
        onNextClick={handleNext}
        onPrevClick={handlePrev}
        onPlayPauseClick={handlePlayPause}
        controlsLocked={isRoom && !isHost}
      />
    </div>
  );
}
