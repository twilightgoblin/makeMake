// -----------------------------------------------------------------------------
// Makemake — App (Phase 4: Single Player)
//
// Owns the AudioPlayer instance for its entire lifetime. Passes state
// snapshots down to PlayerBar and selection callbacks to SongLibrary.
// -----------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from 'react';
import { AudioPlayer } from './lib/AudioPlayer';
import { SongLibrary } from './components/SongLibrary';
import { PlayerBar } from './components/PlayerBar';
import type { PlayerState, Song } from './types';

const INITIAL_PLAYER_STATE: PlayerState = {
  status: 'idle',
  song: null,
  positionSecs: 0,
  durationSecs: 0,
  volume: 0.8,
  queueIndex: -1,
};

export default function App() {
  const [playerState, setPlayerState] = useState<PlayerState>(INITIAL_PLAYER_STATE);
  const playerRef = useRef<AudioPlayer | null>(null);

  // Create the AudioPlayer once on mount; destroy it on unmount.
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

  const handlePlay = useCallback(() => playerRef.current?.play(), []);
  const handlePause = useCallback(() => playerRef.current?.pause(), []);
  const handleSeek = useCallback((secs: number) => playerRef.current?.seek(secs), []);
  const handleNext = useCallback(() => playerRef.current?.next(), []);
  const handlePrevious = useCallback(() => playerRef.current?.previous(), []);
  const handleVolumeChange = useCallback(
    (vol: number) => playerRef.current?.setVolume(vol),
    [],
  );

  return (
    <div className="app">
      <header className="app-header">
        <span className="app-logo">♪</span>
        <h1 className="app-title">Makemake</h1>
      </header>

      <main className="app-main">
        <SongLibrary
          activeSongId={playerState.song?.id ?? null}
          onSelect={handleSelect}
        />
      </main>

      <PlayerBar
        state={playerState}
        onPlay={handlePlay}
        onPause={handlePause}
        onSeek={handleSeek}
        onNext={handleNext}
        onPrevious={handlePrevious}
        onVolumeChange={handleVolumeChange}
      />
    </div>
  );
}
