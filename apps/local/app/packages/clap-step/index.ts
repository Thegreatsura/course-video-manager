// Entry point (public, client-safe) for the clap-step package.
//
// THE CLAP STEP of an AV Calibration (#2137): Matt lines up one clap by eye
// and ear. The sound slider moves in 1 ms steps over the mic's waveform, the
// video slider in one camera frame steps, and the Mic Offset is the gap
// between them. This file is the pure part (the maths and the wire shape);
// `server.ts` reads the files with ffmpeg.
export {
  CLAP_STEP_WINDOW_MS,
  PLAY_LOOP_SECONDS,
  clapStepMicOffsetMs,
  frameAtMs,
  frameMs,
  loudestMs,
  startingVideoFrame,
  waveformPeaks,
  type ClapStepData,
} from "./lib/clap-step";
