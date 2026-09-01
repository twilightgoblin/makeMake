// -----------------------------------------------------------------------------
// Makemake — SoloPage (Phase 4: single-player mode)
//
// The original App.tsx experience, now at /solo.
// Owns its own AudioPlayer instance for the lifetime of this route.
// -----------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AudioPlayer } from '../lib/AudioPlayer';
import { SongLibrary } from '../components/SongLibrary';
import { PlayerBar } from '../components/PlayerBar';
import type { PlayerState, Song } from '../types';

const INITIAL_PLAYER_STATE: PlayerState = {
  status: 'idle',
  song: null,
  positionSecs: 0,
  durationSecs: 0,
  volume: 0.8,
  queueIndex: -1,
};

export function SoloPage() {
  const navigate = useNavigate();
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

  const handleSelect = useCallback((song: Song, queue: Song[]) => {
    const player = playerRef.current;
    if (!player) return;
    const startIndex = queue.findIndex((s) => s.id === song.id);
    player.loadQueue(queue, startIndex >= 0 ? startIndex : 0);
  }, []);

  return (
    <div className="app">
      <header className="app-header">
        <button
          className="btn btn--ghost btn--sm"
          onClick={() => void navigate('/')}
          aria-label="Back to home"
        >
          ←
        </button>
        <span className="app-logo">♪</span>
        <h1 className="app-title">Solo Mode</h1>
      </header>

      <main className="app-main">
        <SongLibrary
          activeSongId={playerState.song?.id ?? null}
          onSelect={handleSelect}
        />
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
