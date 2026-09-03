// -----------------------------------------------------------------------------
// Makemake — SongLibrary
//
// Fetches GET /songs (with optional search + pagination) and renders a
// scrollable list. Clicking a row fires onSelect(song, allSongs) so the
// parent can load the entire visible library into the AudioPlayer queue
// starting at the clicked track.
//
// Props:
//   activeSongId   — highlights the currently playing song
//   onSelect       — (song: Song, queue: Song[]) => void
// -----------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Song, SongsResponse } from '../types';
import { formatDuration } from '../lib/formatDuration';

const PAGE_SIZE = 50;

interface Props {
  activeSongId: string | null;
  onSelect: (song: Song, queue: Song[]) => void;
}

export function SongLibrary({ activeSongId, onSelect }: Props) {
  const [songs, setSongs] = useState<Song[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState('');
  const [pendingSearch, setPendingSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Debounce search input: wait 300 ms after the last keystroke.
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setPendingSearch(val);
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      setSearch(val);
      setOffset(0);
    }, 300);
  };

  const fetchSongs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(offset),
      });
      if (search.trim()) params.set('search', search.trim());

      const res = await fetch(`/songs?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: SongsResponse = await res.json() as SongsResponse;
      setSongs(data.songs);
      setTotal(data.total || 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load songs');
    } finally {
      setLoading(false);
    }
  }, [search, offset]);

  useEffect(() => {
    void fetchSongs();
  }, [fetchSongs]);

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  return (
    <div className="library">
      {/* Search bar */}
      <div className="library-search">
        <span className="library-search-icon" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" strokeWidth="1.5" />
            <line x1="10" y1="10" x2="14.5" y2="14.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </span>
        <input
          className="library-search-input"
          type="search"
          placeholder="Search songs, artists, albums…"
          value={pendingSearch}
          onChange={handleSearchChange}
          aria-label="Search songs"
        />
      </div>

      {/* Song list */}
      <div className="library-list" role="listbox" aria-label="Song library">
        {loading && songs.length === 0 && (
          <div className="library-state">Loading…</div>
        )}
        {error && (
          <div className="library-state library-state--error">
            {error}
            <button className="btn-ghost" onClick={() => void fetchSongs()}>
              Retry
            </button>
          </div>
        )}
        {!loading && !error && songs.length === 0 && (
          <div className="library-state">No songs found.</div>
        )}

        {songs.map((song) => {
          const isActive = song.id === activeSongId;
          return (
            <button
              key={song.id}
              role="option"
              aria-selected={isActive}
              className={`song-row${isActive ? ' song-row--active' : ''}`}
              onClick={() => onSelect(song, songs)}
            >
              <img
                className="song-row-cover"
                src={song.coverUrl}
                alt=""
                aria-hidden="true"
                loading="lazy"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.visibility = 'hidden';
                }}
              />
              <div className="song-row-meta">
                <span className="song-row-title">{song.title}</span>
                <span className="song-row-artist">
                  {song.artist}
                  {song.album ? ` · ${song.album}` : ''}
                </span>
              </div>
              <span className="song-row-duration">
                {formatDuration(song.duration)}
              </span>
              {isActive && (
                <span className="song-row-playing-badge" aria-label="Now playing">
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
                    <rect x="1" y="3" width="2.5" height="8" rx="1">
                      <animate attributeName="height" values="8;4;8" dur="0.8s" repeatCount="indefinite" />
                      <animate attributeName="y" values="3;5;3" dur="0.8s" repeatCount="indefinite" />
                    </rect>
                    <rect x="5.75" y="1" width="2.5" height="12" rx="1">
                      <animate attributeName="height" values="12;6;12" dur="0.8s" begin="0.2s" repeatCount="indefinite" />
                      <animate attributeName="y" values="1;4;1" dur="0.8s" begin="0.2s" repeatCount="indefinite" />
                    </rect>
                    <rect x="10.5" y="2" width="2.5" height="10" rx="1">
                      <animate attributeName="height" values="10;5;10" dur="0.8s" begin="0.1s" repeatCount="indefinite" />
                      <animate attributeName="y" values="2;4.5;2" dur="0.8s" begin="0.1s" repeatCount="indefinite" />
                    </rect>
                  </svg>
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="library-pagination" aria-label="Pagination">
          <button
            className="btn-ghost"
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            aria-label="Previous page"
          >
            ←
          </button>
          <span className="library-pagination-info">
            {currentPage} / {totalPages}
          </span>
          <button
            className="btn-ghost"
            disabled={offset + PAGE_SIZE >= total}
            onClick={() => setOffset(offset + PAGE_SIZE)}
            aria-label="Next page"
          >
            →
          </button>
        </div>
      )}
    </div>
  );
}
