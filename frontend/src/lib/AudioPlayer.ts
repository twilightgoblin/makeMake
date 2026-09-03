// -----------------------------------------------------------------------------
// Makemake — AudioPlayer engine (YouTube adapter)
//
// A plain class that manages a YouTubePlayerAdapter instance. It is intentionally decoupled
// from React: the caller passes an onChange callback and receives a fresh
// PlayerState snapshot on every meaningful change. React just reads snapshots.
//
// Public API
// ----------
//   loadQueue(songs, startIndex)  — set queue + start playing from index
//   play()
//   pause()
//   seek(positionSecs)
//   next()
//   previous()
//   setVolume(0–1)
//   getState()                    — returns the latest PlayerState snapshot
//   destroy()                     — remove all listeners, pause audio
// -----------------------------------------------------------------------------

import type { PlayerState, PlayerStatus, Song } from '../types';
import { YouTubePlayerAdapter } from './YouTubePlayerAdapter';
import type { YTPlayerState } from './YouTubePlayerAdapter';

export type PlayerStateChangeCallback = (state: PlayerState) => void;

export class AudioPlayer {
  private adapter: YouTubePlayerAdapter | null = null;
  private queue: Song[] = [];
  private queueIndex = -1;
  private status: PlayerStatus = 'idle';
  private onChange: PlayerStateChangeCallback;
  private positionTimer: number | null = null;
  private currentVolume = 1;
  /**
   * Tracks whether the last load was requested with autoplay=true.
   * Used to call adapter.play() when the YT player signals 'cued' or 'paused'
   * after a cueVideoById call (browser autoplay block recovery).
   */
  private wantsAutoplay = false;
  /**
   * When true, the 'ended' event does NOT auto-advance to the next track.
   * RoomPage sets this so that song transitions are driven by the server
   * (NEXT/PREVIOUS broadcasts) rather than local state.
   */
  roomMode = false;

  constructor(onChange: PlayerStateChangeCallback) {
    this.onChange = onChange;
    this.startPositionTimer();
    // Eagerly initialise the adapter on the next microtask so the DOM is
    // guaranteed to have rendered #youtube-player-container before we query it.
    // Doing this here (rather than lazily on the first playback call) means
    // one AudioPlayer = one YouTubePlayerAdapter = one YT.Player, and the
    // player has maximum time to reach isReady before loadSong() arrives.
    Promise.resolve().then(() => { this.getAdapter(); });
  }

  private getAdapter() {
    if (!this.adapter) {
      const container = document.getElementById('youtube-player-container');
      if (container) {
        this.adapter = new YouTubePlayerAdapter({
          containerId: 'youtube-player-container',
          onStateChange: this.handleYTStateChange.bind(this),
          onError: this.handleYTError.bind(this),
          onReady: () => {
            this.adapter?.setVolume(this.currentVolume);
          },
        });
      }
    }
    return this.adapter;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** Replace the current queue and immediately start playing from startIndex. */
  loadQueue(songs: Song[], startIndex = 0, autoplay = true, positionSecs = 0): void {
    this.queue = songs;
    this.loadIndex(startIndex, autoplay, positionSecs);
  }

  /**
   * Load a single song at a specific position.
   * Used by room mode to apply server-authoritative state.
   */
  loadSong(song: Song, positionSecs: number, autoplay: boolean): void {
    this.queue = [song];
    this.queueIndex = 0;
    this.status = 'loading';
    this.wantsAutoplay = autoplay;
    this.emit();

    const adapter = this.getAdapter();
    if (adapter) {
      adapter.loadVideoById(song.externalId, positionSecs, autoplay);
    }
  }

  /**
   * Seek to positionSecs and set playing state without changing the loaded
   * track. Used by the drift-correction loop and SEEK/PLAY/PAUSE broadcasts.
   */
  syncTo(positionSecs: number, isPlaying: boolean): void {
    if (this.status === 'idle') return;
    this.wantsAutoplay = isPlaying;
    const adapter = this.getAdapter();
    if (adapter) {
      adapter.seekTo(positionSecs);
      if (isPlaying) {
        adapter.play();
      } else {
        adapter.pause();
      }
    }
    this.emit();
  }

  async play(): Promise<void> {
    if (this.status === 'idle') return;
    this.getAdapter()?.play();
  }

  pause(): void {
    this.wantsAutoplay = false;
    this.getAdapter()?.pause();
  }

  seek(positionSecs: number): void {
    this.getAdapter()?.seekTo(positionSecs);
    this.emit();
  }

  next(): void {
    if (this.queue.length === 0) return;
    const nextIdx =
      this.queueIndex < this.queue.length - 1 ? this.queueIndex + 1 : 0;
    this.loadIndex(nextIdx, true);
  }

  previous(): void {
    if (this.queue.length === 0) return;
    const adapter = this.getAdapter();
    const currentTime = adapter?.getCurrentTime() || 0;
    // If we're more than 3 s into the track, restart it instead of going back.
    if (currentTime > 3) {
      adapter?.seekTo(0);
      this.emit();
      return;
    }
    const prevIdx =
      this.queueIndex > 0 ? this.queueIndex - 1 : this.queue.length - 1;
    this.loadIndex(prevIdx, true);
  }

  setVolume(volume: number): void {
    this.currentVolume = Math.max(0, Math.min(1, volume));
    this.getAdapter()?.setVolume(this.currentVolume);
    this.emit();
  }

  getState(): PlayerState {
    return this.buildState();
  }

  getQueue(): Song[] {
    return this.queue;
  }

  /** Clean up — call when the component unmounts. */
  destroy(): void {
    this.stopPositionTimer();
    this.adapter?.destroy();
    this.adapter = null;
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private loadIndex(index: number, autoplay: boolean, positionSecs = 0): void {
    const song = this.queue[index];
    if (!song) return;

    this.queueIndex = index;
    this.status = 'loading';
    this.wantsAutoplay = autoplay;
    this.emit();

    const adapter = this.getAdapter();
    if (adapter) {
      adapter.loadVideoById(song.externalId, positionSecs, autoplay);
    }
  }

  private buildState(): PlayerState {
    const song = this.queue[this.queueIndex] ?? null;
    const adapter = this.getAdapter();
    
    // We override duration with YouTube's reported duration if available
    let durationSecs = song?.duration || 0;
    const ytDuration = adapter?.getDuration() || 0;
    if (ytDuration > 0) {
      durationSecs = ytDuration;
    }

    return {
      status: this.status,
      song,
      positionSecs: adapter?.getCurrentTime() || 0,
      durationSecs,
      volume: this.currentVolume,
      queueIndex: this.queueIndex,
    };
  }

  private emit(): void {
    this.onChange(this.buildState());
  }

  // ---------------------------------------------------------------------------
  // YT Adapter callbacks
  // ---------------------------------------------------------------------------

  private handleYTStateChange(ytState: YTPlayerState) {
    switch (ytState) {
      case 'unstarted':
      case 'buffering':
        this.status = 'loading';
        break;
      case 'cued':
        // YT fired cueVideoById (autoplay=false path) or the video is ready
        // to play. If the caller wanted autoplay, kick play() now.
        this.status = 'loading';
        if (this.wantsAutoplay) {
          this.getAdapter()?.play();
        }
        break;
      case 'playing':
        this.wantsAutoplay = false;
        this.status = 'playing';
        break;
      case 'paused':
        // If the browser blocked autoplay, YT fires paused immediately after
        // loadVideoById. Retry play() once — the user gesture that triggered
        // the original load is still within the browser's activation window.
        if (this.wantsAutoplay) {
          this.wantsAutoplay = false; // prevent infinite loop
          this.getAdapter()?.play();
          return; // don't emit 'paused' — we're about to play
        }
        this.status = 'paused';
        break;
      case 'ended':
        this.wantsAutoplay = false;
        this.status = 'ended';
        this.emit();
        if (!this.roomMode) {
          this.next();
        }
        return; // emit handled
    }
    this.emit();
  }

  private handleYTError(error: number) {
    console.warn('[AudioPlayer] YT error:', error);
    if (error === 101 || error === 150) {
      this.status = 'blocked';
    } else {
      this.status = 'error';
    }
    this.emit();
  }

  // YouTube iframe API does not provide a timeupdate event.
  // We must poll to keep the UI in sync.
  private startPositionTimer() {
    this.positionTimer = window.setInterval(() => {
      if (this.status === 'playing') {
        this.emit();
      }
    }, 500); // 500ms is fine for iPod UI ticks
  }

  private stopPositionTimer() {
    if (this.positionTimer !== null) {
      clearInterval(this.positionTimer);
      this.positionTimer = null;
    }
  }
}
