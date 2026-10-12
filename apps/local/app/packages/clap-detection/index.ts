// Entry point (public, server-only: it runs ffmpeg) for the clap-detection
// package.
//
// A deep module answering one question: "in this AV Calibration's mic and
// camera files, where are the claps, and what is the Mic Offset?" Given the
// two files and the clap window it runs two ffmpeg passes (mic onsets; camera
// motion), pairs each mic onset with the camera's contact frame, and answers
// the claps found, how far their offsets spread, and the median offset.
//
// `matchClaps` is the pure part, over the decoded onset and motion series, so
// it is testable without ffmpeg; `findAudioOnsets` is the mic's pure part.
export {
  detectClaps,
  ClapDetectionError,
  type ClapWindow,
} from "./lib/ffmpeg-passes";
export {
  matchClaps,
  MAX_PAIR_DISTANCE_S,
  type Clap,
  type ClapMatch,
  type MotionPoint,
} from "./lib/match";
export { findAudioOnsets } from "./lib/audio-onsets";
