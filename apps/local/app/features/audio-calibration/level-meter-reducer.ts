import { bandPosition, type BandPosition } from "@/audio-calibration-constants";
import type { LevelMeterMessage } from "./level-meter-wire";

/**
 * THE LEVEL METER on the Audio Calibration page: the mic's loudness, live,
 * from the recorder service's ffmpeg (`level-meter-wire.ts`). Opening the page
 * listens, which starts the meter; leaving it stops listening, which stops it.
 * The page's reducer (`audio-calibration-reducer.ts`) owns the listening, and
 * hands every meter message to this one.
 */
export namespace levelMeterReducer {
  export type Reading = { momentaryLufs: number; shortTermLufs: number };

  export type State = {
    status: "starting" | "running" | "failed";
    /** The mic the meter listens to, once it has said. */
    mic: string | null;
    /** The latest reading; none until the first, and none after a failure. */
    reading: Reading | null;
    /** Why the meter is not running. */
    failure: string | null;
  };

  /** A reading carries when the page heard it, for the session's clock. */
  export type Action =
    | Exclude<LevelMeterMessage, { type: "meter-reading" }>
    | (Extract<LevelMeterMessage, { type: "meter-reading" }> & {
        receivedAtMs: number;
      });
}

type State = levelMeterReducer.State;
type Action = levelMeterReducer.Action;

/** The meter while it starts: what the page shows before the first message. */
export const STARTING_LEVEL_METER: State = {
  status: "starting",
  mic: null,
  reading: null,
  failure: null,
};

export const levelMeterReducer = (state: State, action: Action): State => {
  switch (action.type) {
    case "meter-started":
    case "calibration-started":
      return { ...state, status: "running", mic: action.mic, failure: null };
    case "meter-reading":
      return {
        ...state,
        status: "running",
        failure: null,
        reading: {
          momentaryLufs: action.momentaryLufs,
          shortTermLufs: action.shortTermLufs,
        },
      };
    case "meter-failed":
      return {
        ...state,
        status: "failed",
        failure: action.message,
        reading: null,
      };
    // The meter carries on after a failed run; the session says why.
    case "calibration-failed":
      return state;
  }
};

/** Below this, ebur128 hears nothing: its absolute gate. */
export const SILENT_BELOW_LUFS = -70;

/**
 * What the meter says of the short-term loudness: where it sits against the
 * target band, or that the mic is silent. Null with no reading.
 */
export const meterVerdict = (
  state: State
): (BandPosition & { lufs: number }) | { position: "silent" } | null => {
  if (!state.reading) return null;
  const lufs = state.reading.shortTermLufs;
  if (lufs < SILENT_BELOW_LUFS) return { position: "silent" };
  return { ...bandPosition(lufs), lufs };
};
