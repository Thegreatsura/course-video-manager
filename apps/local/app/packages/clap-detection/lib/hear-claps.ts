import { findAudioOnsets } from "./audio-onsets";
import { matchClaps, type ClapMatch, type MotionPoint } from "./match";

/**
 * One clap the mic heard (`audioS`, in seconds of the file), and whether the
 * camera saw its contact: a clap is found only when it is both.
 */
export type ClapMark = { audioS: number; seen: boolean };

export type HeardClaps = ClapMatch & {
  /** Every onset heard, in order, each marked seen or not. */
  marks: ClapMark[];
};

/**
 * THE CLAP RULES, in one place: the onsets in the mic's samples
 * (`findAudioOnsets`), each looked for in the camera's motion
 * (`matchClaps`). The offline detector runs it over the whole clap window
 * once the run is over; the live preview over as much of the window as has
 * arrived, so its marks are the result so far, and the claps it shows seen
 * are the ones the result will find.
 */
export const hearClaps = (o: {
  /** The mic, mono, from the clap window's start. */
  samples: Float32Array;
  sampleRate: number;
  /** The file time of the first sample. */
  startSeconds: number;
  motion: readonly MotionPoint[];
}): HeardClaps => {
  const onsetsS = findAudioOnsets(o.samples, o.sampleRate, o.startSeconds);
  const match = matchClaps({ onsetsS, motion: o.motion });
  const seen = new Set(match.claps.map((c) => c.audioS));
  return {
    ...match,
    marks: onsetsS.map((audioS) => ({ audioS, seen: seen.has(audioS) })),
  };
};
