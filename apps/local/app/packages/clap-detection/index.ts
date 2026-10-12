// Entry point (public, server-only: it runs ffmpeg) for the clap-detection
// package.
//
// A deep module answering one question: "in this AV Calibration's mic and
// camera files, where are the claps, and what is the Mic Offset?" Given the
// two files and the clap window it runs two ffmpeg passes (mic onsets; camera
// motion), looks for each mic onset's contact in the camera near it, and
// answers the claps found, how far their offsets spread, the median offset,
// and whether the mic had a start-up gap (which leaves the offset untrusted).
//
// `matchClaps` is the pure part, over the decoded onset and motion series, so
// it is testable without ffmpeg; `findAudioOnsets` and `findStartUpGap` are
// the mic's pure parts. The same rules run live during the run (`live.ts`).
export {
  detectClaps,
  ClapDetectionError,
  type ClapDetection,
  type ClapWindow,
} from "./lib/ffmpeg-passes";
export {
  matchClaps,
  CONTACT_WINDOW_S,
  type Clap,
  type ClapMatch,
  type MotionPoint,
} from "./lib/match";
export {
  findAudioOnsets,
  findStartUpGap,
  type StartUpGap,
} from "./lib/audio-onsets";
