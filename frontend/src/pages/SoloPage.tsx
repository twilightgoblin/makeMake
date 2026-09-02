// -----------------------------------------------------------------------------
// Makemake — SoloPage (iPod redesign)
//
// Just you and the iPod. No room panel, no player bar, no sidebar.
// The iPod shell + click wheel is the entire interface.
//
// Song selection from the iPod's songs view calls onSoloSongSelect, which
// loads the full fetched library as a queue into AudioPlayer starting at
// the selected index.
// -----------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AudioPlayer } from '../lib/AudioPlayer';
import { IPod } from '../components/ipod/IPod';
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

  // Called by IPod when user selects a song in the songs view (solo mode).
  // Loads the entire songs[] as a queue starting at the selected index.
  const handleSoloSongSelect = useCallback(
    (song: Song, queue: Song[], index: number) => {
      const player = playerRef.current;
      if (!player) return;
      const startIndex = queue.findIndex((s) => s.id === song.id);
      player.loadQueue(queue, startIndex >= 0 ? startIndex : index);
    },
    [],
  );

  const handlePlay = useCallback(() => { playerRef.current?.play(); }, []);
  const handlePause = useCallback(() => { playerRef.current?.pause(); }, []);
  const handleSeek = useCallback((secs: number) => { playerRef.current?.seek(secs); }, []);
  const handleNext = useCallback(() => { playerRef.current?.next(); }, []);
  const handlePrevious = useCallback(() => { playerRef.current?.previous(); }, []);
  const handleVolumeChange = useCallback((v: number) => { playerRef.current?.setVolume(v); }, []);

  return (
    <div className="solo-page">
      {/* Minimal top bar */}
      <div className="solo-topbar">
        <button
          className="btn btn--ghost btn--sm"
          onClick={() => void navigate('/')}
          aria-label="Back to home"
        >
          ←
        </button>
        <span className="solo-wordmark">Makemake</span>
      </div>

      {/* The iPod is the entire experience */}
      <div className="solo-ipod-zone">
        <IPod
          playerState={playerState}
          onPlay={handlePlay}
          onPause={handlePause}
          onSeek={handleSeek}
          onNext={handleNext}
          onPrevious={handlePrevious}
          onVolumeChange={handleVolumeChange}
          onSoloSongSelect={handleSoloSongSelect}
          isHost={true}
          isRoom={false}
        />
      </div>
    </div>
  );
}
