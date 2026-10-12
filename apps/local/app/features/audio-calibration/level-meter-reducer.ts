import type { EffectEntity, EffectReducer } from "use-effect-reducer";
import { bandPosition, type BandPosition } from "@/audio-calibration-constants";
import type { LevelMeterMessage } from "./level-meter-wire";

/**
 * THE LEVEL METER on the Audio Calibration page: the mic's loudness, live,
 * from the recorder service's ffmpeg (`level-meter-wire.ts`). Opening the page
 * listens, which starts the meter; leaving it stops listening, which stops it.
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
    listener: EffectEntity<State, Action> | null;
  };

  export type Action = LevelMeterMessage | { type: "try-again-clicked" };

  /** Hear the meter until stopped (an SSE subscription). */
  export type Effect = { type: "listen-to-meter" };
}

type State = levelMeterReducer.State;
type Action = levelMeterReducer.Action;
type Effect = levelMeterReducer.Effect;

export const createInitialLevelMeterState = (
  exec: (effect: Effect) => EffectEntity<State, Action>
): State => ({
  status: "starting",
  mic: null,
  reading: null,
  failure: null,
  listener: exec({ type: "listen-to-meter" }),
});

export const levelMeterReducer: EffectReducer<State, Action, Effect> = (
  state,
  action,
  exec
) => {
  switch (action.type) {
    case "meter-started":
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
    case "try-again-clicked":
      if (state.status !== "failed") return state;
      if (state.listener) exec.stop(state.listener);
      return {
        ...state,
        status: "starting",
        failure: null,
        listener: exec({ type: "listen-to-meter" }),
      };
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
