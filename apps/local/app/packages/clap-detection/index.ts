// Entry point (public, pure) for the clap-detection package.
//
// The live clap marks of an AV Calibration's run (#2121): each clap the mic
// hears, and whether the camera saw the hands meet near it. `matchClaps` pairs
// mic onsets with camera contacts; `findAudioOnsets` and `findStartUpGap` are
// the mic's pure parts; `live.ts` runs them during the run. Nothing here
// decides the Mic Offset any more: Matt lines up a clap himself in the clap
// step (`clap-step`, #2137).
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
