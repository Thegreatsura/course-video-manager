/**
 * Shared silence detection constants used by both the backend (ffmpeg-based)
 * and frontend (Web Audio API-based) silence/speech detection.
 *
 * The backend values are the source of truth.
 */

/** dB threshold below which audio is considered silence */
export const SILENCE_THRESHOLD_DB = -38;

/** Minimum duration of silence (in seconds) to count as a gap */
export const SILENCE_DURATION_SECONDS = 0.8;

/** Minimum clip length (in seconds) — clips shorter than this are discarded */
export const MINIMUM_CLIP_LENGTH_SECONDS = 1;
