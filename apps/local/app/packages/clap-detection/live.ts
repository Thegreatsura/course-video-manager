// Entry point (public, pure: no ffmpeg) for the clap-detection package's
// live half: what an AV Calibration's capture needs to mark claps as they
// happen, by the same rules as the offline detector (`index.ts`).
//
// The capture runs `MOTION_FILTERS` over its camera and prints each frame's
// motion to its log (`motionLineReader` reads it back); `hearClaps` is the
// clap rules over the mic samples and motion that have arrived so far.
export { hearClaps, type ClapMark, type HeardClaps } from "./lib/hear-claps";
export { MOTION_FILTERS, MOTION_KEY, motionLineReader } from "./lib/motion";
export type { MotionPoint } from "./lib/match";
