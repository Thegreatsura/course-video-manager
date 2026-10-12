import type { EffectEntity, EffectReducer } from "use-effect-reducer";
import {
  SCRIPT_END_SECONDS,
  SCRIPT_SCHEDULE,
  type ScriptStep,
} from "@/av-calibration-constants";
import type {
  BrowserTracePoint,
  FinishCalibrationRequest,
  SavedAVCalibration,
} from "./calibration-wire";
import type { CalibrationTimeline } from "./calibration-timeline";
import { levelMeterReducer, STARTING_LEVEL_METER } from "./level-meter-reducer";

/**
 * THE AV CALIBRATION PAGE (#2079): the level meter, then the scripted
 * session, then its result.
 *
 *   meter → countdown → silence → read 1 / pause 1 … read 5 / pause 5
 *         → analysing → result
 *
 * The session runs on the recorder service's clock: every meter reading of a
 * run is timed in seconds of its mic file, and the step on screen is the
 * schedule's step at the latest reading (`currentStep`), so the prompts Matt
 * saw and the audio they are measured against share one time axis. When a
 * reading reaches the end of the script the page asks for the measurement,
 * which stores the AV Calibration, passed or failed. Cancel, from any step
 * before the analysis, stores nothing.
 *
 * Alongside, the browser detector's input is traced (`capture-browser-levels`)
 * and timed onto the same axis through the reading heard last.
 *
 * The result shows the calibration's review timeline (#2081), loaded once it
 * is stored. A past calibration's result, timeline and all, opens again from
 * the page's history.
 */
export namespace avCalibrationReducer {
  /** Where the page's clock meets the run's: a reading, and when the page heard it. */
  export type Anchor = { seconds: number; receivedAtMs: number };

  export type Session =
    /** The meter, with Start. */
    | { kind: "meter" }
    /** Start was pressed; the run has not said it runs. */
    | { kind: "starting" }
    | {
        kind: "running";
        calibrationId: string;
        /** Seconds of the run's mic file at the latest reading. */
        seconds: number;
        anchor: Anchor | null;
      }
    | { kind: "analysing"; calibrationId: string }
    | {
        kind: "result";
        calibration: SavedAVCalibration;
        timeline: Timeline;
      }
    /** The session could not go on (refused, ffmpeg quit, not stored). */
    | { kind: "failed"; message: string };

  /** The result's review timeline, as far as it has loaded. */
  export type Timeline =
    | { status: "loading" }
    | { status: "loaded"; timeline: CalibrationTimeline }
    | { status: "failed"; message: string };

  export type Browser = {
    /** The browser's audio input, once open. */
    label: string | null;
    /** Why there is no trace, when the input could not be opened. */
    problem: string | null;
    trace: BrowserTracePoint[];
    capture: EffectEntity<State, Action> | null;
  };

  export type State = {
    meter: levelMeterReducer.State;
    /** The meter's stream: listening is what runs the meter. */
    meterListener: EffectEntity<State, Action> | null;
    session: Session;
    browser: Browser;
  };

  export type Action =
    | levelMeterReducer.Action
    /** The meter failed, and Matt asks for it again. */
    | { type: "try-again-clicked" }
    | { type: "start-clicked" }
    | { type: "cancel-clicked" }
    | { type: "back-to-meter-clicked" }
    | { type: "start-refused"; message: string }
    | { type: "browser-input-opened"; label: string }
    | { type: "browser-input-failed"; message: string }
    /**
     * Peaks of consecutive blocks the browser heard. Block `n` (counted from
     * the first the capture heard) ended at `firstBlockEndedAtMs` (the page's
     * clock) plus `n` blocks: timed by the audio's own sample count.
     */
    | {
        type: "browser-levels-heard";
        firstBlockEndedAtMs: number;
        firstBlock: number;
        blockSeconds: number;
        peaksDb: number[];
      }
    | {
        type: "calibration-saved";
        calibrationId: string;
        calibration: SavedAVCalibration;
      }
    | { type: "calibration-not-saved"; calibrationId: string; message: string }
    /** Matt opens a past calibration from the history. */
    | { type: "past-calibration-clicked"; calibration: SavedAVCalibration }
    | {
        type: "timeline-loaded";
        calibrationId: string;
        timeline: CalibrationTimeline;
      }
    | { type: "timeline-not-loaded"; calibrationId: string; message: string };

  export type Effect =
    | { type: "listen-to-meter" }
    | { type: "start-calibration" }
    | { type: "cancel-calibration" }
    | ({ type: "finish-calibration" } & FinishCalibrationRequest)
    /** Open the browser detector's input and report its levels until stopped. */
    | { type: "capture-browser-levels" }
    | { type: "load-timeline"; calibrationId: string }
    /** A calibration was stored: the page's history is out of date. */
    | { type: "refresh-history" };
}

type State = avCalibrationReducer.State;
type Action = avCalibrationReducer.Action;
type Effect = avCalibrationReducer.Effect;

const noBrowser = (): avCalibrationReducer.Browser => ({
  label: null,
  problem: null,
  trace: [],
  capture: null,
});

export const createInitialAVCalibrationState = (
  exec: (effect: Effect) => EffectEntity<State, Action>
): State => ({
  meter: STARTING_LEVEL_METER,
  meterListener: exec({ type: "listen-to-meter" }),
  session: { kind: "meter" },
  browser: noBrowser(),
});

/** Stops the browser capture, keeping what it heard. */
const stopCapture = (
  state: State,
  exec: Parameters<EffectReducer<State, Action, Effect>>[2]
): avCalibrationReducer.Browser => {
  if (state.browser.capture) exec.stop(state.browser.capture);
  return { ...state.browser, capture: null };
};

const fail = (
  state: State,
  exec: Parameters<EffectReducer<State, Action, Effect>>[2],
  message: string
): State => ({
  ...state,
  session: { kind: "failed", message },
  browser: stopCapture(state, exec),
});

/** In a run: a reading moves the clock on; the last one ends the script. */
const onReading = (
  state: State,
  reading: { seconds: number; receivedAtMs: number },
  exec: Parameters<EffectReducer<State, Action, Effect>>[2]
): State => {
  const session = state.session;
  if (session.kind !== "running") return state;
  if (reading.seconds < SCRIPT_END_SECONDS)
    return {
      ...state,
      session: {
        ...session,
        seconds: reading.seconds,
        anchor: session.anchor ?? reading,
      },
    };
  const browser = stopCapture(state, exec);
  exec({
    type: "finish-calibration",
    calibrationId: session.calibrationId,
    browserInputLabel: browser.label,
    browserTrace: browser.label ? browser.trace : null,
  });
  return {
    ...state,
    session: { kind: "analysing", calibrationId: session.calibrationId },
    browser,
  };
};

/** A calibration's result, its timeline loading. */
const showResult = (
  state: State,
  calibration: SavedAVCalibration,
  exec: Parameters<EffectReducer<State, Action, Effect>>[2]
): State => {
  exec({ type: "load-timeline", calibrationId: calibration.id });
  return {
    ...state,
    session: { kind: "result", calibration, timeline: { status: "loading" } },
  };
};

export const avCalibrationReducer: EffectReducer<State, Action, Effect> = (
  state,
  action,
  exec
) => {
  switch (action.type) {
    case "meter-started":
    case "meter-failed":
      return { ...state, meter: levelMeterReducer(state.meter, action) };
    case "try-again-clicked":
      if (state.meter.status !== "failed") return state;
      if (state.meterListener) exec.stop(state.meterListener);
      return {
        ...state,
        meter: STARTING_LEVEL_METER,
        meterListener: exec({ type: "listen-to-meter" }),
      };
    case "meter-reading":
      return onReading(
        { ...state, meter: levelMeterReducer(state.meter, action) },
        action,
        exec
      );
    case "calibration-started": {
      const meter = levelMeterReducer(state.meter, action);
      if (state.session.kind !== "starting") return { ...state, meter };
      return {
        ...state,
        meter,
        session: {
          kind: "running",
          calibrationId: action.calibrationId,
          seconds: 0,
          anchor: null,
        },
      };
    }
    case "calibration-failed": {
      const session = state.session;
      if (
        (session.kind !== "running" && session.kind !== "analysing") ||
        session.calibrationId !== action.calibrationId
      )
        return state;
      return fail(state, exec, action.message);
    }
    case "start-clicked": {
      const { kind } = state.session;
      if (kind !== "meter" && kind !== "result" && kind !== "failed")
        return state;
      if (state.meter.status !== "running") return state;
      exec({ type: "start-calibration" });
      return {
        ...state,
        session: { kind: "starting" },
        browser: {
          ...noBrowser(),
          capture: exec({ type: "capture-browser-levels" }),
        },
      };
    }
    case "start-refused":
      if (state.session.kind !== "starting") return state;
      return fail(state, exec, action.message);
    case "cancel-clicked": {
      const { kind } = state.session;
      if (kind !== "starting" && kind !== "running") return state;
      exec({ type: "cancel-calibration" });
      stopCapture(state, exec);
      return { ...state, session: { kind: "meter" }, browser: noBrowser() };
    }
    case "back-to-meter-clicked":
      if (state.session.kind !== "result" && state.session.kind !== "failed")
        return state;
      return { ...state, session: { kind: "meter" } };
    case "browser-input-opened":
      if (!state.browser.capture) return state;
      return {
        ...state,
        browser: { ...state.browser, label: action.label, problem: null },
      };
    case "browser-input-failed":
      if (!state.browser.capture) return state;
      return {
        ...state,
        browser: { ...state.browser, label: null, problem: action.message },
      };
    case "browser-levels-heard": {
      const session = state.session;
      if (
        session.kind !== "running" ||
        !session.anchor ||
        !state.browser.capture
      )
        return state;
      const { anchor } = session;
      const points = action.peaksDb.map((peakDb, i) => {
        const endedAtMs =
          action.firstBlockEndedAtMs +
          (action.firstBlock + i) * action.blockSeconds * 1000;
        return {
          seconds:
            anchor.seconds +
            (endedAtMs - anchor.receivedAtMs) / 1000 -
            action.blockSeconds,
          peakDb,
        };
      });
      return {
        ...state,
        browser: {
          ...state.browser,
          trace: [...state.browser.trace, ...points],
        },
      };
    }
    case "calibration-saved":
      if (
        state.session.kind !== "analysing" ||
        state.session.calibrationId !== action.calibrationId
      )
        return state;
      exec({ type: "refresh-history" });
      return showResult(state, action.calibration, exec);
    case "past-calibration-clicked": {
      const { kind } = state.session;
      if (kind !== "meter" && kind !== "result" && kind !== "failed")
        return state;
      return showResult(state, action.calibration, exec);
    }
    case "timeline-loaded":
    case "timeline-not-loaded": {
      const session = state.session;
      if (
        session.kind !== "result" ||
        session.calibration.id !== action.calibrationId
      )
        return state;
      return {
        ...state,
        session: {
          ...session,
          timeline:
            action.type === "timeline-loaded"
              ? { status: "loaded", timeline: action.timeline }
              : { status: "failed", message: action.message },
        },
      };
    }
    case "calibration-not-saved":
      if (
        state.session.kind !== "analysing" ||
        state.session.calibrationId !== action.calibrationId
      )
        return state;
      return fail(state, exec, action.message);
  }
};

/** The step of the script at `seconds`, and the seconds left in it. */
export const stepAt = (
  seconds: number
): { step: ScriptStep; remainingSeconds: number } | null => {
  const step = SCRIPT_SCHEDULE.find(
    (s) => seconds >= s.startSeconds && seconds < s.endSeconds
  );
  return step ? { step, remainingSeconds: step.endSeconds - seconds } : null;
};

/** What the session shows now: the run's current step, or null outside a run. */
export const currentStep = (state: State) =>
  state.session.kind === "running"
    ? (stepAt(state.session.seconds) ?? null)
    : null;
