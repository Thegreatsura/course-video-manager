export const FINAL_VIDEO_PADDING = 0.5 - 0.08;
export const INSERTION_POINT_ID = "insertion-point";
export const RECORDING_SESSION_PANELS_ID = "recording-session-panels";
export const BEAT_DURATION = 0.4;
/**
 * Gain (in dB) the editor's preview player adds on top of the raw recording,
 * so footage plays back near final loudness. Preview only: exports are
 * normalised separately by ffmpeg `loudnorm`. Lowered from 14 to 12 after
 * the mic input level went up and preview became too loud.
 */
export const PREVIEW_AUDIO_BOOST_DB = 12;
