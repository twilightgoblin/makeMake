// -----------------------------------------------------------------------------
// Makemake — PlayerBar
//
// The persistent playback strip fixed at the bottom of the screen.
//
// Layout (matches the spec diagram):
//
//   [ cover | title / artist ]   [ ◀◀  ▶/❚❚  ▶▶ ]   [ seek bar ]   [ 🔊 vol ]
//
// Props mirror the AudioPlayer API — the parent passes callbacks so the bar
// never imports AudioPlayer directly. This keeps it pure and testable.
// -----------------------------------------------------------------------------

import type { PlayerState } from '../types';
import { formatDuration } from '../lib/formatDuration';

interface Props {
  state: PlayerState;
  onPlay: () => void;
  onPause: () => void;
  onSeek: (secs: number) => void;
  onNext: () => void;
  onPrevious: () => void;
  onVolumeChange: (vol: number) => void;
}

export function PlayerBar({
  state,
  onPlay,
  onPause,
  onSeek,
  onNext,
  onPrevious,
  onVolumeChange,
}: Props) {
  const { song, status, positionSecs, durationSecs, volume } = state;

  const isPlaying = status === 'playing';
  const isIdle = status === 'idle';
  const isError = status === 'error';
  const progress = durationSecs > 0 ? positionSecs / durationSecs : 0;

  const handleSeekInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    onSeek(Number(e.target.value));
  };

  const handleVolumeInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    onVolumeChange(Number(e.target.value));
  };

  const togglePlay = () => {
    if (isPlaying) onPause();
    else onPlay();
  };

  return (
    <footer className="player-bar" aria-label="Music player">
      {/* ── Left: cover + track info ─────────────────────────────────────── */}
      <div className="player-bar-track">
        {song ? (
          <>
            <img
              className="player-bar-cover"
              src={song.coverUrl}
              alt={`Cover for ${song.title}`}
              onError={(e) => {
                (e.target as HTMLImageElement).style.visibility = 'hidden';
              }}
            />
            <div className="player-bar-meta">
              <span className="player-bar-title">{song.title}</span>
              <span className="player-bar-artist">{song.artist}</span>
            </div>
          </>
        ) : (
          <span className="player-bar-empty">
            {isError ? 'Failed to load audio' : 'Select a song to play'}
          </span>
        )}
      </div>

      {/* ── Centre: controls + seek bar ──────────────────────────────────── */}
      <div className="player-bar-centre">
        <div className="player-controls" role="group" aria-label="Playback controls">
          <button
            className="ctrl-btn"
            onClick={onPrevious}
            disabled={isIdle}
            aria-label="Previous track"
            title="Previous"
          >
            <PreviousIcon />
          </button>

          <button
            className="ctrl-btn ctrl-btn--primary"
            onClick={togglePlay}
            disabled={isIdle || status === 'loading'}
            aria-label={isPlaying ? 'Pause' : 'Play'}
            title={isPlaying ? 'Pause' : 'Play'}
          >
            {status === 'loading' ? <SpinnerIcon /> : isPlaying ? <PauseIcon /> : <PlayIcon />}
          </button>

          <button
            className="ctrl-btn"
            onClick={onNext}
            disabled={isIdle}
            aria-label="Next track"
            title="Next"
          >
            <NextIcon />
          </button>
        </div>

        {/* Seek bar */}
        <div className="seek-row" aria-label="Seek">
          <span className="seek-time">{formatDuration(positionSecs)}</span>
          <div className="seek-track">
            <div
              className="seek-fill"
              style={{ width: `${progress * 100}%` }}
              aria-hidden="true"
            />
            <input
              type="range"
              className="seek-input"
              min={0}
              max={durationSecs || 1}
              step={0.5}
              value={positionSecs}
              onChange={handleSeekInput}
              disabled={isIdle || durationSecs === 0}
              aria-label="Seek position"
              aria-valuemin={0}
              aria-valuemax={durationSecs}
              aria-valuenow={Math.round(positionSecs)}
              aria-valuetext={`${formatDuration(positionSecs)} of ${formatDuration(durationSecs)}`}
            />
          </div>
          <span className="seek-time seek-time--total">{formatDuration(durationSecs)}</span>
        </div>
      </div>

      {/* ── Right: volume ────────────────────────────────────────────────── */}
      <div className="player-bar-right">
        <button
          className="ctrl-btn ctrl-btn--sm"
          aria-label={volume === 0 ? 'Unmute' : 'Mute'}
          title={volume === 0 ? 'Unmute' : 'Mute'}
          onClick={() => onVolumeChange(volume === 0 ? 0.7 : 0)}
        >
          {volume === 0 ? <MuteIcon /> : volume < 0.5 ? <VolumeLowIcon /> : <VolumeHighIcon />}
        </button>
        <input
          type="range"
          className="volume-input"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          onChange={handleVolumeInput}
          aria-label="Volume"
          aria-valuemin={0}
          aria-valuemax={1}
          aria-valuenow={Math.round(volume * 100)}
          aria-valuetext={`${Math.round(volume * 100)}%`}
        />
      </div>
    </footer>
  );
}

// ---------------------------------------------------------------------------
// SVG icons — inline, no external dependency
// ---------------------------------------------------------------------------

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
      <path d="M8 5.14v14l11-7-11-7z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
      <rect x="6" y="4" width="4" height="16" rx="1" />
      <rect x="14" y="4" width="4" height="16" rx="1" />
    </svg>
  );
}

function PreviousIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
      <path d="M6 6h2v12H6zm3.5 6 8.5 6V6z" />
    </svg>
  );
}

function NextIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
      <path d="M6 18l8.5-6L6 6v12zm8.5-6v6H17V6h-2.5v6z" />
    </svg>
  );
}

function VolumeHighIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
      <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 7.97v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
    </svg>
  );
}

function VolumeLowIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
      <path d="M18.5 12A4.5 4.5 0 0 0 16 7.97v8.05c1.48-.73 2.5-2.25 2.5-4.02zM5 9v6h4l5 5V4L9 9H5z" />
    </svg>
  );
}

function MuteIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
      <path d="M16.5 12A4.5 4.5 0 0 0 14 7.97v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.796 8.796 0 0 0 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06a8.99 8.99 0 0 0 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4 9.91 6.09 12 8.18V4z" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
      <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
      <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round">
        <animateTransform
          attributeName="transform"
          type="rotate"
          from="0 12 12"
          to="360 12 12"
          dur="0.8s"
          repeatCount="indefinite"
        />
      </path>
    </svg>
  );
}
