export type YTPlayerState = 'unstarted' | 'ended' | 'playing' | 'paused' | 'buffering' | 'cued';

export interface YouTubePlayerOptions {
  containerId: string;
  onReady?: () => void;
  onStateChange?: (state: YTPlayerState) => void;
  onError?: (error: number) => void;
}

export class YouTubePlayerAdapter {
  private player: any = null;
  private options: YouTubePlayerOptions;
  private isReady = false;
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
        this.createPlayer();
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
        iv_load_policy: 3
      },
      events: {
        onReady: this.handleReady.bind(this),
        onStateChange: this.handleStateChange.bind(this),
        onError: this.handleError.bind(this)
      }
    });
  }

  private handleReady(event: any) {
    // Reassign from event.target — YT.Player's onReady can fire before
    // new YT.Player(...) returns in some environments, leaving this.player null.
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
    const stateMap: Record<number, YTPlayerState> = {
      [-1]: 'unstarted',
      0: 'ended',
      1: 'playing',
      2: 'paused',
      3: 'buffering',
      5: 'cued'
    };
    const state = stateMap[event.data];
    if (state) {
      this.options.onStateChange?.(state);
    }
  }

  private handleError(event: any) {
    this.options.onError?.(event.data);
  }

  loadVideoById(videoId: string, startSeconds: number = 0, autoplay: boolean = true) {
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
    if (this.isReady && this.player.playVideo) {
      this.player.playVideo();
    }
  }

  pause() {
    if (this.isReady && this.player.pauseVideo) {
      this.player.pauseVideo();
    }
  }

  seekTo(seconds: number) {
    if (this.isReady && this.player.seekTo) {
      this.player.seekTo(seconds, true);
    }
  }

  setVolume(volume: number) { // 0 to 1
    const ytVolume = Math.round(volume * 100);
    if (this.isReady && this.player.setVolume) {
      this.player.setVolume(ytVolume);
    } else {
      this.pendingVolume = ytVolume;
    }
  }

  getCurrentTime(): number {
    return this.isReady && this.player.getCurrentTime ? this.player.getCurrentTime() : 0;
  }

  getDuration(): number {
    return this.isReady && this.player.getDuration ? this.player.getDuration() : 0;
  }

  destroy() {
    if (this.isReady && this.player.destroy) {
      this.player.destroy();
    }
    this.player = null;
    this.isReady = false;
  }
}

declare global {
  interface Window {
    YT: any;
    onYouTubeIframeAPIReady: () => void;
  }
}
