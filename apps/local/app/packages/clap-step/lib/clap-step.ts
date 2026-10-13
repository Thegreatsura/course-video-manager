import { CAMERA_FPS } from "@/av-calibration-constants";

/**
 * How far either side of the loudest point the waveform and the video slider
 * reach, in ms: room for any Mic Offset seen so far (-92 to +150 ms) and a
 * clap's rise, small enough that a 1 ms step shows.
 */
export const CLAP_STEP_WINDOW_MS = 500;

/** How long Play loops, centred on the clap, in seconds. */
export const PLAY_LOOP_SECONDS = 2;

/** What the clap step opens with, for the latest AV Calibration. */
export type ClapStepData = {
  calibrationId: string;
  /** Where slider 1 starts: the loudest point in the clap window, in ms of the mic file. */
  loudestMs: number;
  /**
   * The waveform: the mic's peak (0 to 1) in each 1 ms from `startMs`, over
   * `CLAP_STEP_WINDOW_MS` either side of `loudestMs`.
   */
  waveform: { startMs: number; peaks: number[] };
  /** The Mic Offset the step starts from: the pair's current one, in ms. */
  micOffsetMs: number;
};

/** When camera frame `frame` starts, in ms of the camera file (CFR from 0). */
export const frameMs = (frame: number) => (frame * 1000) / CAMERA_FPS;

/** The camera frame on screen at `ms` of the camera file, to the nearest. */
export const frameAtMs = (ms: number) => Math.round((ms * CAMERA_FPS) / 1000);

/**
 * THE MIC OFFSET the sliders say, in whole ms: how much later the mic's sound
 * is played at export, so video time - sound time (GLOSSARY.md; the sign every
 * Recording Session and export already use).
 */
export const clapStepMicOffsetMs = (soundMs: number, videoFrame: number) =>
  Math.round(frameMs(videoFrame) - soundMs);

/** Where slider 2 starts: slider 1's time shifted by the current Mic Offset. */
export const startingVideoFrame = (soundMs: number, micOffsetMs: number) =>
  frameAtMs(soundMs + micOffsetMs);

/** The index of the loudest sample (absolute), as ms from the first sample. */
export const loudestMs = (samples: Float32Array, sampleRate: number) => {
  let at = 0;
  let peak = -1;
  for (let i = 0; i < samples.length; i++) {
    const x = Math.abs(samples[i]!);
    if (x > peak) {
      peak = x;
      at = i;
    }
  }
  return Math.round((at * 1000) / sampleRate);
};

/** Each 1 ms's peak (0 to 1) of `samples`, rounded to 3 places. */
export const waveformPeaks = (samples: Float32Array, sampleRate: number) => {
  const perMs = sampleRate / 1000;
  const bins = Math.floor(samples.length / perMs);
  const peaks: number[] = [];
  for (let b = 0; b < bins; b++) {
    let peak = 0;
    const end = Math.round((b + 1) * perMs);
    for (let i = Math.round(b * perMs); i < end; i++)
      peak = Math.max(peak, Math.abs(samples[i]!));
    peaks.push(Math.round(Math.min(peak, 1) * 1000) / 1000);
  }
  return peaks;
};
