// -----------------------------------------------------------------------------
// IPodScreen — the LCD display inside the iPod shell
//
// Renders one of several "views" based on the current screen state:
//
//   menu        → top-level navigation (Music, Now Playing, …)
//   nowPlaying  → album art + track info + progress bar
//   playlist    → scrollable room playlist
//   songs       → browseable song library (add to playlist / play in solo)
//   info        → song metadata overlay (triggered by swipe-up)
//
// The parent (IPod) owns the view state and passes callbacks for every
// action the screen needs to surface. The screen itself is purely presentational.
// -----------------------------------------------------------------------------

import { useEffect, useRef } from 'react';
import type { PlayerState, Song } from '../../types';
import type { PlaylistEntry } from '../../lib/api';
import { formatDuration } from '../../lib/formatDuration';

// ---------------------------------------------------------------------------
// View types
// ---------------------------------------------------------------------------

export type ScreenView =
  | 'menu'
  | 'musicMenu'
  | 'nowPlaying'
  | 'playlist'
  | 'songs'
  | 'search'
  | 'info';

export interface MenuItem {
  id: string;
  label: string;
  target: ScreenView;
}

export const MAIN_MENU: MenuItem[] = [
  { id: 'now-playing', label: 'Now Playing', target: 'nowPlaying' },
  { id: 'music',       label: 'Music',       target: 'musicMenu' },
  { id: 'playlist',    label: 'Playlist',    target: 'playlist' },
];

export const SOLO_MENU: MenuItem[] = [
  { id: 'now-playing', label: 'Now Playing', target: 'nowPlaying' },
  { id: 'music',       label: 'Music',       target: 'musicMenu' },
];

export const MUSIC_MENU: MenuItem[] = [
  { id: 'all-songs', label: 'All Songs', target: 'songs' },
  { id: 'search',    label: 'Search',    target: 'search' },
];

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface IPodScreenProps {
  view: ScreenView;
  playerState: PlayerState;
  /** Current menu selection index (for keyboard/wheel nav in menu view) */
  menuIndex: number;
  /** Playlist selection index (for wheel nav in playlist view) */
  playlistIndex: number;
  /** Song library selection index (for wheel nav in songs view) */
  songIndex: number;
  playlist: PlaylistEntry[];
  songs: Song[];
  songsLoading: boolean;
  songsError: string | null;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  isHost: boolean;
  /** Whether this is a room (true) or solo (false) — affects menu items */
  isRoom: boolean;
  socketStatus?: 'connecting' | 'open' | 'closed' | 'error';
  onMenuSelect: (item: MenuItem) => void;
  /** Called when a playlist entry is tapped (HOST → jump to song) */
  onPlaylistSelect: (entry: PlaylistEntry, index: number) => void;
  /** Called when a song row is tapped (add to playlist in room / play in solo) */
  onSongSelect: (song: Song, index: number) => void;
  onResumeClick?: () => void;
}

// ---------------------------------------------------------------------------
// Status bar
// ---------------------------------------------------------------------------

function StatusBar({
  view,
  isPlaying,
  socketStatus,
  isRoom,
}: {
  view: ScreenView;
  isPlaying: boolean;
  socketStatus?: string;
  isRoom: boolean;
}) {
  const label = (() => {
    if (view === 'nowPlaying') return isPlaying ? '▶ Now Playing' : '❚❚ Paused';
    if (view === 'playlist') return 'Playlist';
    if (view === 'musicMenu') return 'Music';
    if (view === 'songs') return 'All Songs';
    if (view === 'search') return 'Search';
    if (view === 'info') return 'Song Info';
    return 'MAKEMAKE';
  })();

  const wsIndicator = isRoom
    ? socketStatus === 'open'
      ? '●'
      : socketStatus === 'connecting'
        ? '○'
        : '✕'
    : null;

  return (
    <div className="lcd-statusbar" role="status" aria-live="polite">
      <div className="lcd-statusbar-left">
        <span>{label}</span>
      </div>
      <div className="lcd-statusbar-right">
        {wsIndicator && <span title={`WebSocket: ${socketStatus}`}>{wsIndicator}</span>}
        <span className="lcd-battery">🔋</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Menu view
// ---------------------------------------------------------------------------

function MenuView({
  items,
  selectedIndex,
  onSelect,
}: {
  items: MenuItem[];
  selectedIndex: number;
  onSelect: (item: MenuItem) => void;
}) {
  return (
    <div className="lcd-menu" role="listbox" aria-label="Navigation menu">
      {items.map((item, i) => (
        <div
          key={item.id}
          role="option"
          aria-selected={i === selectedIndex}
          className={`lcd-menu-item${i === selectedIndex ? ' lcd-menu-item--selected' : ''}`}
          onClick={() => onSelect(item)}
        >
          <span>{item.label}</span>
          <span className="lcd-menu-arrow">›</span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Now Playing view
// ---------------------------------------------------------------------------

function NowPlayingView({
  playerState,
  isHost,
  isRoom,
  onResumeClick,
}: {
  playerState: PlayerState;
  isHost: boolean;
  isRoom: boolean;
  onResumeClick?: () => void;
}) {
  const { song, status, positionSecs, durationSecs } = playerState;
  const isPlaying = status === 'playing';
  const isBlocked = status === 'blocked';
  const isLoading = status === 'loading';
  const progress = durationSecs > 0 ? positionSecs / durationSecs : 0;

  if (!song && status === 'idle') {
    return (
      <div className="lcd-now-playing">
        <div className="lcd-album-art-placeholder" aria-hidden="true">♪</div>
        <span className="lcd-track-title" style={{ marginTop: 6 }}>
          {isRoom
            ? isHost
              ? 'Add songs to playlist'
              : 'Waiting for host…'
            : 'Select a song'}
        </span>
      </div>
    );
  }

  return (
    <div className="lcd-now-playing" aria-label="Now playing">
      <div id="youtube-player-portal" style={{ width: '100%', height: '140px', marginBottom: '8px' }}>
        {/* The YouTube iframe will be visually moved here by CSS if needed, 
            or we can just keep the iframe persistent in the root and position it here.
            Actually, the simplest is to just have a placeholder here and position the absolute iframe over it. */}
      </div>

      <span className="lcd-track-title">{song?.title ?? '—'}</span>
      <span className="lcd-track-artist">{song?.artist ?? ''}</span>

      {/* Progress bar */}
      <div className="lcd-progress-row" aria-label="Playback progress">
        <span className="lcd-time">{formatDuration(positionSecs)}</span>
        <div className="lcd-progress-track" role="progressbar" aria-valuenow={positionSecs} aria-valuemax={durationSecs}>
          <div
            className="lcd-progress-fill"
            style={{ width: `${Math.min(progress * 100, 100)}%` }}
          />
        </div>
        <span className="lcd-time">{formatDuration(durationSecs)}</span>
      </div>

      <div className="lcd-playback-row">
        {isLoading ? (
          <span className="lcd-play-icon">…</span>
        ) : isBlocked ? (
          <div 
            className="lcd-play-controls" 
            style={{ fontWeight: 'bold', cursor: 'pointer', padding: '4px' }}
            onClick={onResumeClick}
            role="button"
            tabIndex={0}
          >
            ▶ TAP TO RESUME
          </div>
        ) : (
          <div className="lcd-play-controls">
            <span className="lcd-play-icon" aria-hidden="true">⏮</span>
            <span className="lcd-play-icon" aria-label={isPlaying ? 'Playing' : 'Paused'} style={{ fontSize: '14px' }}>
              {isPlaying ? '▶' : '❚❚'}
            </span>
            <span className="lcd-play-icon" aria-hidden="true">⏭</span>
          </div>
        )}
        {isRoom && !isHost && !isBlocked && (
          <span className="lcd-locked-hint" style={{ marginTop: '4px' }}>host controls playback</span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Playlist view
// ---------------------------------------------------------------------------

const VISIBLE_ROWS = 8;

function PlaylistView({
  playlist,
  selectedIndex,
  currentSongId,
  onSelect,
}: {
  playlist: PlaylistEntry[];
  selectedIndex: number;
  currentSongId: string | null;
  onSelect: (entry: PlaylistEntry, index: number) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Keep selected row visible
  useEffect(() => {
    if (!scrollRef.current) return;
    const rows = scrollRef.current.querySelectorAll<HTMLDivElement>('.lcd-playlist-item');
    const row = rows[selectedIndex];
    row?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  if (playlist.length === 0) {
    return (
      <div className="lcd-playlist">
        <div className="lcd-songs-loading">No songs in playlist</div>
      </div>
    );
  }

  const startIdx = Math.max(0, selectedIndex - Math.floor(VISIBLE_ROWS / 2));
  const visible = playlist.slice(startIdx, startIdx + VISIBLE_ROWS);

  return (
    <div className="lcd-playlist" aria-label="Room playlist">
      <div className="lcd-playlist-scroll" ref={scrollRef}>
        {visible.map((entry, vi) => {
          const realIdx = startIdx + vi;
          const isSel = realIdx === selectedIndex;
          const isPlaying = entry.song.id === currentSongId;
          return (
            <div
              key={entry.id}
              role="option"
              aria-selected={isSel}
              className={`lcd-playlist-item${isSel ? ' lcd-playlist-item--selected' : ''}`}
              onClick={() => onSelect(entry, realIdx)}
            >
              <span className="lcd-playlist-item-num">{realIdx + 1}</span>
              <span className="lcd-playlist-item-title">{entry.song.title}</span>
              {isPlaying && (
                <span className="lcd-playlist-item-playing" aria-label="Now playing">▶</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Song library view
// ---------------------------------------------------------------------------

function SongsView({
  songs,
  loading,
  error,
  selectedIndex,
  currentSongId,
  isRoom,
  onSelect,
}: {
  songs: Song[];
  loading: boolean;
  error: string | null;
  selectedIndex: number;
  currentSongId: string | null;
  isRoom: boolean;
  onSelect: (song: Song, index: number) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!scrollRef.current) return;
    const rows = scrollRef.current.querySelectorAll<HTMLDivElement>('.lcd-playlist-item');
    const row = rows[selectedIndex];
    row?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  if (loading) {
    return (
      <div className="lcd-songs">
        <div className="lcd-songs-loading">
          <div className="lcd-spinner" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="lcd-songs">
        <div className="lcd-songs-loading">{error}</div>
      </div>
    );
  }

  if (songs.length === 0) {
    return (
      <div className="lcd-songs">
        <div className="lcd-songs-loading">No songs found</div>
      </div>
    );
  }

  const startIdx = Math.max(0, selectedIndex - Math.floor(VISIBLE_ROWS / 2));
  const visible = songs.slice(startIdx, startIdx + VISIBLE_ROWS);

  return (
    <div className="lcd-songs" aria-label={isRoom ? 'Add song to playlist' : 'Song library'}>
      <div className="lcd-playlist-scroll" ref={scrollRef}>
        {visible.map((song, vi) => {
          const realIdx = startIdx + vi;
          const isSel = realIdx === selectedIndex;
          const isPlaying = song.id === currentSongId;
          return (
            <div
              key={song.id}
              role="option"
              aria-selected={isSel}
              className={`lcd-playlist-item${isSel ? ' lcd-playlist-item--selected' : ''}`}
              onClick={() => onSelect(song, realIdx)}
            >
              <span className="lcd-playlist-item-num">{realIdx + 1}</span>
              <span className="lcd-playlist-item-title">
                {song.title}
                <span style={{ opacity: 0.65 }}> — {song.artist}</span>
              </span>
              {isPlaying && (
                <span className="lcd-playlist-item-playing" aria-label="Now playing">▶</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Search view
// ---------------------------------------------------------------------------

function SearchView({
  searchQuery,
  onSearchChange,
  songs,
  loading,
  error,
  selectedIndex,
  currentSongId,
  onSelect,
}: {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  songs: Song[];
  loading: boolean;
  error: string | null;
  selectedIndex: number;
  currentSongId: string | null;
  onSelect: (song: Song, index: number) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Keep input focused so user can type on physical keyboard
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
    }
  }, []);

  // Scroll to selected result
  useEffect(() => {
    if (!scrollRef.current) return;
    const rows = scrollRef.current.querySelectorAll<HTMLDivElement>('.lcd-playlist-item');
    const row = rows[selectedIndex];
    row?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  const renderResults = () => {
    if (loading) {
      return (
        <div className="lcd-songs-loading" style={{ marginTop: 20 }}>
          <div className="lcd-spinner" />
        </div>
      );
    }
    if (error) {
      return <div className="lcd-songs-loading" style={{ marginTop: 20 }}>{error}</div>;
    }
    if (songs.length === 0 && searchQuery) {
      return <div className="lcd-songs-loading" style={{ marginTop: 20 }}>No songs found</div>;
    }

    const startIdx = Math.max(0, selectedIndex - Math.floor(4 / 2)); // fewer visible rows due to input
    const visible = songs.slice(startIdx, startIdx + 4);

    return (
      <div className="lcd-playlist-scroll" ref={scrollRef}>
        {visible.map((song, vi) => {
          const realIdx = startIdx + vi;
          const isSel = realIdx === selectedIndex;
          const isPlaying = song.id === currentSongId;
          return (
            <div
              key={song.id}
              role="option"
              aria-selected={isSel}
              className={`lcd-playlist-item${isSel ? ' lcd-playlist-item--selected' : ''}`}
              onClick={() => onSelect(song, realIdx)}
            >
              <span className="lcd-playlist-item-num">{realIdx + 1}</span>
              <span className="lcd-playlist-item-title">
                {song.title}
                <span style={{ opacity: 0.65 }}> — {song.artist}</span>
              </span>
              {isPlaying && (
                <span className="lcd-playlist-item-playing" aria-label="Now playing">▶</span>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="lcd-songs" aria-label="Search songs">
      <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--lcd-text)' }}>
        <input
          ref={inputRef}
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search songs..."
          style={{
            width: '100%',
            fontFamily: 'inherit',
            fontSize: '14px',
            background: 'transparent',
            border: '1px solid var(--lcd-text)',
            color: 'var(--lcd-text)',
            padding: '4px',
            outline: 'none',
          }}
        />
        <div style={{ fontSize: '10px', marginTop: '4px', opacity: 0.7 }}>
          {songs.length} results
        </div>
      </div>
      {renderResults()}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Info view (swipe-up)
// ---------------------------------------------------------------------------

function InfoView({ song }: { song: Song | null }) {
  if (!song) {
    return (
      <div className="lcd-info">
        <div className="lcd-songs-loading">No song loaded</div>
      </div>
    );
  }

  return (
    <div className="lcd-info" aria-label="Song information">
      <div className="lcd-info-row">
        <span className="lcd-info-label">Title</span>
        <span className="lcd-info-value">{song.title}</span>
      </div>
      <div className="lcd-info-row">
        <span className="lcd-info-label">Artist</span>
        <span className="lcd-info-value">{song.artist}</span>
      </div>
      {song.album && (
        <div className="lcd-info-row">
          <span className="lcd-info-label">Album</span>
          <span className="lcd-info-value">{song.album}</span>
        </div>
      )}
      <div className="lcd-info-row">
        <span className="lcd-info-label">Duration</span>
        <span className="lcd-info-value">{formatDuration(song.duration)}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// IPodScreen (root export)
// ---------------------------------------------------------------------------

export function IPodScreen({
  view,
  playerState,
  menuIndex,
  playlistIndex,
  songIndex,
  playlist,
  songs,
  songsLoading,
  songsError,
  searchQuery,
  onSearchChange,
  isHost,
  isRoom,
  socketStatus,
  onMenuSelect,
  onPlaylistSelect,
  onSongSelect,
  onResumeClick,
}: IPodScreenProps) {
  const menuItems = isRoom ? MAIN_MENU : SOLO_MENU;

  const renderContent = () => {
    switch (view) {
      case 'menu':
        return (
          <MenuView
            items={menuItems}
            selectedIndex={menuIndex}
            onSelect={onMenuSelect}
          />
        );
      case 'musicMenu':
        return (
          <MenuView
            items={MUSIC_MENU}
            selectedIndex={menuIndex}
            onSelect={onMenuSelect}
          />
        );
      case 'nowPlaying':
        return (
          <NowPlayingView
            playerState={playerState}
            isHost={isHost}
            isRoom={isRoom}
            onResumeClick={onResumeClick}
          />
        );
      case 'playlist':
        return (
          <PlaylistView
            playlist={playlist}
            selectedIndex={playlistIndex}
            currentSongId={playerState.song?.id ?? null}
            onSelect={onPlaylistSelect}
          />
        );
      case 'songs':
        return (
          <SongsView
            songs={songs}
            loading={songsLoading}
            error={songsError}
            selectedIndex={songIndex}
            currentSongId={playerState.song?.id ?? null}
            isRoom={isRoom}
            onSelect={onSongSelect}
          />
        );
      case 'search':
        return (
          <SearchView
            searchQuery={searchQuery}
            onSearchChange={onSearchChange}
            songs={songs}
            loading={songsLoading}
            error={songsError}
            selectedIndex={songIndex}
            currentSongId={playerState.song?.id ?? null}
            onSelect={onSongSelect}
          />
        );
      case 'info':
        return <InfoView song={playerState.song} />;
    }
  };

  return (
    <>
      <StatusBar
        view={view}
        isPlaying={playerState.status === 'playing'}
        socketStatus={socketStatus}
        isRoom={isRoom}
      />
      <div className="lcd-content" style={{ position: 'relative' }}>
        {/* Persistent YouTube container */}
        <div 
          id="youtube-player-container" 
          style={{
            position: 'absolute',
            top: '0',
            left: '0',
            width: '100%',
            height: '140px',
            zIndex: 10,
            // Hide it if we are not in nowPlaying or if there is no song loaded
            opacity: (view === 'nowPlaying' && playerState.song) ? 1 : 0,
            pointerEvents: (view === 'nowPlaying' && playerState.song) ? 'auto' : 'none',
          }}
        />
        <div style={{ paddingTop: (view === 'nowPlaying' && playerState.song) ? '148px' : '0' }}>
          {renderContent()}
        </div>
      </div>
    </>
  );
}
