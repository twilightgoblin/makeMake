// -----------------------------------------------------------------------------
// Makemake — AudioPlayer engine
//
// A plain class that owns one HTMLAudioElement. It is intentionally decoupled
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

export type PlayerStateChangeCallback = (state: PlayerState) => void;

export class AudioPlayer {
  private audio: HTMLAudioElement;
  private queue: Song[] = [];
  private queueIndex = -1;
  private status: PlayerStatus = 'idle';
  private onChange: PlayerStateChangeCallback;

  constructor(onChange: PlayerStateChangeCallback) {
    this.onChange = onChange;
    this.audio = new Audio();
    this.audio.preload = 'auto';
    this.bindEvents();
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** Replace the current queue and immediately start playing from startIndex. */
  loadQueue(songs: Song[], startIndex = 0): void {
    this.queue = songs;
    this.loadIndex(startIndex, true);
  }

  play(): void {
    if (this.status === 'idle' || !this.audio.src) return;
    void this.audio.play();
  }

  pause(): void {
    this.audio.pause();
  }

  seek(positionSecs: number): void {
    if (!isFinite(this.audio.duration)) return;
    const clamped = Math.max(0, Math.min(positionSecs, this.audio.duration));
    this.audio.currentTime = clamped;
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
    // If we're more than 3 s into the track, restart it instead of going back.
    if (this.audio.currentTime > 3) {
      this.audio.currentTime = 0;
      this.emit();
      return;
    }
    const prevIdx =
      this.queueIndex > 0 ? this.queueIndex - 1 : this.queue.length - 1;
    this.loadIndex(prevIdx, true);
  }

  setVolume(volume: number): void {
    this.audio.volume = Math.max(0, Math.min(1, volume));
    this.emit();
  }

  getState(): PlayerState {
    return this.buildState();
  }

  /** Clean up — call when the component unmounts. */
  destroy(): void {
    this.audio.pause();
    this.unbindEvents();
    this.audio.src = '';
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private loadIndex(index: number, autoplay: boolean): void {
    const song = this.queue[index];
    if (!song) return;

    this.queueIndex = index;
    this.status = 'loading';
    this.audio.src = song.audioUrl;
    this.audio.currentTime = 0;
    this.emit();

    if (autoplay) {
      void this.audio.play();
    }
  }

  private buildState(): PlayerState {
    const song = this.queue[this.queueIndex] ?? null;
    return {
      status: this.status,
      song,
      positionSecs: isFinite(this.audio.currentTime) ? this.audio.currentTime : 0,
      durationSecs: isFinite(this.audio.duration) ? this.audio.duration : 0,
      volume: this.audio.volume,
      queueIndex: this.queueIndex,
    };
  }

  private emit(): void {
    this.onChange(this.buildState());
  }

  // ---------------------------------------------------------------------------
  // HTMLAudioElement event bindings
  // ---------------------------------------------------------------------------

  private onCanPlay = (): void => {
    // Only transition from loading → playing/paused here, not from other states.
    if (this.status === 'loading') {
      this.status = this.audio.paused ? 'paused' : 'playing';
      this.emit();
    }
  };

  private onPlay = (): void => {
    this.status = 'playing';
    this.emit();
  };

  private onPause = (): void => {
    // 'ended' fires before 'pause' in some browsers — don't clobber it.
    if (this.status !== 'ended') {
      this.status = 'paused';
      this.emit();
    }
  };

  private onTimeUpdate = (): void => {
    // Emit position ticks only when actually playing to avoid unnecessary renders.
    if (this.status === 'playing') {
      this.emit();
    }
  };

  private onEnded = (): void => {
    this.status = 'ended';
    this.emit();
    // Auto-advance to next track (wraps around).
    this.next();
  };

  private onError = (): void => {
    this.status = 'error';
    this.emit();
  };

  private onDurationChange = (): void => {
    this.emit();
  };

  private onVolumeChange = (): void => {
    this.emit();
  };

  private bindEvents(): void {
    this.audio.addEventListener('canplay', this.onCanPlay);
    this.audio.addEventListener('play', this.onPlay);
    this.audio.addEventListener('pause', this.onPause);
    this.audio.addEventListener('timeupdate', this.onTimeUpdate);
    this.audio.addEventListener('ended', this.onEnded);
    this.audio.addEventListener('error', this.onError);
    this.audio.addEventListener('durationchange', this.onDurationChange);
    this.audio.addEventListener('volumechange', this.onVolumeChange);
  }

  private unbindEvents(): void {
    this.audio.removeEventListener('canplay', this.onCanPlay);
    this.audio.removeEventListener('play', this.onPlay);
    this.audio.removeEventListener('pause', this.onPause);
    this.audio.removeEventListener('timeupdate', this.onTimeUpdate);
    this.audio.removeEventListener('ended', this.onEnded);
    this.audio.removeEventListener('error', this.onError);
    this.audio.removeEventListener('durationchange', this.onDurationChange);
    this.audio.removeEventListener('volumechange', this.onVolumeChange);
  }
}
