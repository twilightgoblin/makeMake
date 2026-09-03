export type YTPlayerState = 'unstarted' | 'ended' | 'playing' | 'paused' | 'buffering' | 'cued';

export interface YouTubePlayerOptions {
  containerId: string;
  onReady?: () => void;
  onStateChange?: (state: YTPlayerState) => void;
  onError?: (error: number) => void;
}

// ---------------------------------------------------------------------------
// YouTubePlayerAdapter
//
// One instance per AudioPlayer. Each mounted iPod gets its own adapter and
// its own YT.Player attached to its #youtube-player-container element.
//
// StrictMode safety: React runs effects twice in development (mount →
// cleanup → mount). The first adapter is destroyed during cleanup, and the
// second is created fresh. This is correct — the first YT.Player.destroy()
// call removes the iframe so the second new YT.Player() gets a clean div.
// The `destroyed` flag prevents any API calls on a stale instance.
//
// The pendingVideo queue handles the case where loadVideoById() is called
// before onReady fires (which happens when the adapter is created and
// loadSong() arrives before the YT iframe has initialised). handleReady()
// consumes the queue exactly once.
// ---------------------------------------------------------------------------

export class YouTubePlayerAdapter {
  private player: any = null;
  private options: YouTubePlayerOptions;
  private isReady = false;
  private destroyed = false;
  private pendingVideo: { videoId: string; startSeconds: number; autoplay: boolean } | null = null;
  private pendingVolume: number | null = null;

  constructor(options: YouTubePlayerOptions) {
    this.options = options;
    this.init();
  }

  private init() {
    if (window.YT && window.YT.Player) {
      this.createPlayer();
    } else {
      const originalCallback = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        if (originalCallback) originalCallback();
        if (!this.destroyed) {
          this.createPlayer();
        }
      };
    }
  }

  private createPlayer() {
    this.player = new window.YT.Player(this.options.containerId, {
      height: '100%',
      width: '100%',
      playerVars: {
        autoplay: 0,
        controls: 0,
        disablekb: 1,
        fs: 0,
        modestbranding: 1,
        rel: 0,
        showinfo: 0,
        iv_load_policy: 3,
      },
      events: {
        onReady: this.handleReady.bind(this),
        onStateChange: this.handleStateChange.bind(this),
        onError: this.handleError.bind(this),
      },
    });
  }

  private handleReady(event: any) {
    if (this.destroyed) return;
    this.player = event.target;
    this.isReady = true;
    if (this.pendingVolume !== null) {
      this.player.setVolume(this.pendingVolume);
      this.pendingVolume = null;
    }
    if (this.pendingVideo) {
      const { videoId, startSeconds, autoplay } = this.pendingVideo;
      this.pendingVideo = null;
      if (autoplay) {
        this.player.loadVideoById(videoId, startSeconds);
      } else {
        this.player.cueVideoById(videoId, startSeconds);
      }
    }
    this.options.onReady?.();
  }

  private handleStateChange(event: any) {
    if (this.destroyed) return;
    const stateMap: Record<number, YTPlayerState> = {
      [-1]: 'unstarted',
      0: 'ended',
      1: 'playing',
      2: 'paused',
      3: 'buffering',
      5: 'cued',
    };
    const state = stateMap[event.data];
    if (state) {
      this.options.onStateChange?.(state);
    }
  }

  private handleError(event: any) {
    if (this.destroyed) return;
    this.options.onError?.(event.data);
  }

  loadVideoById(videoId: string, startSeconds = 0, autoplay = true) {
    if (this.destroyed) return;
    if (!this.isReady) {
      this.pendingVideo = { videoId, startSeconds, autoplay };
      return;
    }
    if (autoplay) {
      this.player.loadVideoById(videoId, startSeconds);
    } else {
      this.player.cueVideoById(videoId, startSeconds);
    }
  }

  play() {
    if (this.destroyed) return;
    if (this.isReady && this.player?.playVideo) {
      try {
        this.player.playVideo();
      } catch (e) {
        console.warn('[YTAdapter] play() threw:', e);
      }
    }
  }

  pause() {
    if (this.destroyed) return;
    if (this.isReady && this.player?.pauseVideo) {
      this.player.pauseVideo();
    }
  }

  seekTo(seconds: number) {
    if (this.destroyed) return;
    if (this.isReady && this.player?.seekTo) {
      this.player.seekTo(seconds, true);
    }
  }

  setVolume(volume: number) {
    if (this.destroyed) return;
    const ytVolume = Math.round(volume * 100);
    if (this.isReady && this.player?.setVolume) {
      this.player.setVolume(ytVolume);
    } else {
      this.pendingVolume = ytVolume;
    }
  }

  getCurrentTime(): number {
    if (this.destroyed) return 0;
    return this.isReady && this.player?.getCurrentTime ? this.player.getCurrentTime() : 0;
  }

  getDuration(): number {
    if (this.destroyed) return 0;
    return this.isReady && this.player?.getDuration ? this.player.getDuration() : 0;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.isReady = false;
    this.pendingVideo = null;
    if (this.player?.destroy) {
      try {
        this.player.destroy();
      } catch {
        // YT.Player.destroy() can throw if the iframe was already removed
        // from the DOM (e.g. route change unmounted the container first).
      }
    }
    this.player = null;
  }
}

declare global {
  interface Window {
    YT: any;
    onYouTubeIframeAPIReady: () => void;
  }
}
