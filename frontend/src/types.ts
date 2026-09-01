// -----------------------------------------------------------------------------
// Makemake — shared frontend types
// These mirror the backend API response shapes exactly.
// -----------------------------------------------------------------------------

export interface Song {
  id: string;
  title: string;
  artist: string;
  album: string | null;
  duration: number; // seconds (integer)
  coverUrl: string;
  audioUrl: string;
}

export interface SongsResponse {
  songs: Song[];
  total: number;
  limit: number;
  offset: number;
}

// ---------------------------------------------------------------------------
// AudioPlayer state — what the player exposes to React
// ---------------------------------------------------------------------------

export type PlayerStatus =
  | 'idle'      // no song loaded
  | 'loading'   // src set, waiting for canplay
  | 'playing'
  | 'paused'
  | 'ended'
  | 'error';

export interface PlayerState {
  status: PlayerStatus;
  song: Song | null;
  positionSecs: number;
  durationSecs: number;
  volume: number;       // 0–1
  /** Index into the current queue, or -1 if none */
  queueIndex: number;
}
