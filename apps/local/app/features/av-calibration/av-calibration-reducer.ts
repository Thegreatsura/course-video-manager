import type { EffectEntity, EffectReducer } from "use-effect-reducer";
import {
  CAM_LINK_IN_USE_TO_CALIBRATE,
  runMeasurementWindows,
  SCRIPT_END_SECONDS,
  SCRIPT_SCHEDULE,
  type ScriptStep,
} from "@/av-calibration-constants";
import type {
  FinishCalibrationRequest,
  SavedAVCalibration,
} from "./calibration-wire";
import type { ClapMark } from "@/packages/clap-detection/live";
import type { CalibrationTimeline } from "./calibration-timeline";
import { levelMeterReducer, STARTING_LEVEL_METER } from "./level-meter-reducer";
import { loudnessMisses } from "@/av-calibration-constants";
import type { ClapStepData } from "@/packages/clap-step";
import {
  clapStepOffsetMs,
  clapStepReducer,
  startingClapStep,
} from "./clap-step-reducer";

export { clapStepOffsetMs, soundRange, videoRange } from "./clap-step-reducer";

/**
 * THE AV CALIBRATION PAGE (#2079): the level meter, then the scripted
 * session, then its result.
 *
 *   meter → starting (the camera opening) → countdown → silence
 *         → hands up → clap 1 … clap 5 → read 1 / pause 1 … read 5 / pause 5
 *         → loud → analysing → result
 *
 * The session runs on the recorder service's clock: every meter reading of a
 * run is timed in seconds of its mic and camera files, the script starting
 * where the run went live (`scriptStartSeconds`, once the camera opened), and
 * the step on screen is the schedule's step at the latest reading
 * (`currentStep`), so the prompts Matt saw and the audio and picture they are
 * measured against share one time axis. When a reading reaches the end of
 * the script the page asks for the measurement over the script's windows in
 * the files' seconds (the silence, the speech and the clap window), which
 * stores the AV Calibration, passed or failed. Cancel, from any step before
 * the analysis, stores nothing.
 *
 * Start opens the camera first. Another app holding the Cam Link refuses
 * it with `CAM_LINK_IN_USE_TO_CALIBRATE`: the session never starts, and the
 * page says another app is using the Cam Link, with Start, which works
 * again as soon as that app lets go. A camera that opens but sends nothing is refused with
 * the "Cam Link not starting" message, as any other refusal.
 *
 * During the clap step each clap shows as the mic hears it, marked seen once
 * the camera saw its contact (`calibration-claps`, worked out by the
 * recorder service with the result's own rules, so the claps marked seen are
 * the claps the result finds).
 *
 * The result shows the calibration's review timeline (#2081), loaded once it
 * is stored. A past calibration's result, timeline and all, opens again from
 * the page's history.
 */
export namespace avCalibrationReducer {
  export type Session =
    /** The meter, with Start. */
    | { kind: "meter" }
    /** Start was pressed; the run has not said it runs. */
    | { kind: "starting" }
    /** Start was refused: another app holds the Cam Link. */
    | { kind: "camera-busy" }
    | {
        kind: "running";
        calibrationId: string;
        /** Where the script starts, in seconds of the run's files. */
        scriptStartSeconds: number;
        /** Seconds of the script at the latest reading (negative: not yet). */
        seconds: number;
        /** The claps heard so far, each seen or not (`calibration-claps`). */
        claps: ClapMark[];
      }
    | { kind: "analysing"; calibrationId: string }
    | {
        kind: "result";
        calibration: SavedAVCalibration;
        timeline: Timeline;
        /**
         * The clap step (#2137): only on the latest calibration, once its
         * loudness check passed; null otherwise.
         */
        clapStep: ClapStep | null;
      }
    /** The session could not go on (refused, ffmpeg quit, not stored). */
    | { kind: "failed"; message: string };

  export type ClapStep = clapStepReducer.ClapStep;

  /** The result's review timeline, as far as it has loaded. */
  export type Timeline =
    | { status: "loading" }
    | { status: "loaded"; timeline: CalibrationTimeline }
    | { status: "failed"; message: string };

  export type State = {
    meter: levelMeterReducer.State;
    /** The meter's stream: listening is what runs the meter. */
    meterListener: EffectEntity<State, Action> | null;
    session: Session;
  };

  export type Action =
    | levelMeterReducer.Action
    /** The page mounted (again, under Strict Mode): start listening to the meter. */
    | { type: "page-opened" }
    /** The meter failed, and Matt asks for it again. */
    | { type: "try-again-clicked" }
    | { type: "start-clicked" }
    | { type: "cancel-clicked" }
    | { type: "back-to-meter-clicked" }
    | { type: "start-refused"; message: string }
    | {
        type: "calibration-saved";
        calibrationId: string;
        calibration: SavedAVCalibration;
      }
    | { type: "calibration-not-saved"; calibrationId: string; message: string }
    /** Matt opens a past calibration from the history; `latest`: the newest one. */
    | {
        type: "past-calibration-clicked";
        calibration: SavedAVCalibration;
        latest: boolean;
      }
    | { type: "clap-step-loaded"; calibrationId: string; data: ClapStepData }
    | { type: "clap-step-not-loaded"; calibrationId: string; message: string }
    | clapStepReducer.Action
    | { type: "save-mic-offset-clicked" }
    | {
        type: "mic-offset-saved";
        calibrationId: string;
        calibration: SavedAVCalibration;
      }
    | { type: "mic-offset-not-saved"; calibrationId: string; message: string }
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
    | { type: "load-timeline"; calibrationId: string }
    | { type: "load-clap-step"; calibrationId: string }
    | { type: "save-mic-offset"; calibrationId: string; micOffsetMs: number }
    /** A calibration was stored: the page's history is out of date. */
    | { type: "refresh-history" };
}

type State = avCalibrationReducer.State;
type Action = avCalibrationReducer.Action;
type Effect = avCalibrationReducer.Effect;

/**
 * Nothing listens yet: the page starts the meter once it has opened
 * (`page-opened`), so a Strict Mode remount, which stops the first listener,
 * gets one of its own (as the Storage page, #2136).
 */
export const createInitialAVCalibrationState = (): State => ({
  meter: STARTING_LEVEL_METER,
  meterListener: null,
  session: { kind: "meter" },
});

const fail = (state: State, message: string): State => ({
  ...state,
  session: { kind: "failed", message },
});

/** In a run: a reading moves the clock on; the last one ends the script. */
const onReading = (
  state: State,
  reading: { seconds: number },
  exec: Parameters<EffectReducer<State, Action, Effect>>[2]
): State => {
  const session = state.session;
  if (session.kind !== "running") return state;
  const seconds = reading.seconds - session.scriptStartSeconds;
  if (seconds < SCRIPT_END_SECONDS)
    return {
      ...state,
      session: { ...session, seconds },
    };
  exec({
    type: "finish-calibration",
    calibrationId: session.calibrationId,
    scriptStartSeconds: session.scriptStartSeconds,
    windows: runMeasurementWindows(session.scriptStartSeconds),
  });
  return {
    ...state,
    session: { kind: "analysing", calibrationId: session.calibrationId },
  };
};

/**
 * A calibration's result, its timeline loading, and its clap step when it
 * is the latest and its loudness check passed (#2137).
 */
const showResult = (
  state: State,
  calibration: SavedAVCalibration,
  latest: boolean,
  exec: Parameters<EffectReducer<State, Action, Effect>>[2]
): State => {
  exec({ type: "load-timeline", calibrationId: calibration.id });
  const clapStep = latest && loudnessMisses(calibration).length === 0;
  if (clapStep) exec({ type: "load-clap-step", calibrationId: calibration.id });
  return {
    ...state,
    session: {
      kind: "result",
      calibration,
      timeline: { status: "loading" },
      clapStep: clapStep ? { status: "loading" } : null,
    },
  };
};

/** Moves a slider of a ready clap step, or turns Play on or off. */
const onClapStep = (state: State, action: clapStepReducer.Action): State => {
  const session = state.session;
  if (session.kind !== "result" || session.clapStep?.status !== "ready")
    return state;
  return {
    ...state,
    session: {
      ...session,
      clapStep: clapStepReducer(session.clapStep, action),
    },
  };
};

/**
 * No run in progress: Start, and a past calibration, may be opened. The
 * meter, a result, a failure or a refused Start.
 */
export const isSessionIdle = (session: avCalibrationReducer.Session) =>
  session.kind === "meter" ||
  session.kind === "result" ||
  session.kind === "failed" ||
  session.kind === "camera-busy";

export const avCalibrationReducer: EffectReducer<State, Action, Effect> = (
  state,
  action,
  exec
) => {
  switch (action.type) {
    case "meter-started":
    case "meter-failed":
      return { ...state, meter: levelMeterReducer(state.meter, action) };
    case "page-opened":
      if (state.meterListener) exec.stop(state.meterListener);
      return {
        ...state,
        meter: STARTING_LEVEL_METER,
        meterListener: exec({ type: "listen-to-meter" }),
      };
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
          scriptStartSeconds: action.scriptStartSeconds,
          seconds: 0,
          claps: [],
        },
      };
    }
    case "calibration-claps": {
      const session = state.session;
      if (
        session.kind !== "running" ||
        session.calibrationId !== action.calibrationId
      )
        return state;
      return { ...state, session: { ...session, claps: action.claps } };
    }
    case "calibration-failed": {
      const session = state.session;
      if (
        (session.kind !== "running" && session.kind !== "analysing") ||
        session.calibrationId !== action.calibrationId
      )
        return state;
      return fail(state, action.message);
    }
    case "start-clicked": {
      if (!isSessionIdle(state.session)) return state;
      if (state.meter.status !== "running") return state;
      exec({ type: "start-calibration" });
      return { ...state, session: { kind: "starting" } };
    }
    case "start-refused":
      if (state.session.kind !== "starting") return state;
      if (action.message === CAM_LINK_IN_USE_TO_CALIBRATE)
        return { ...state, session: { kind: "camera-busy" } };
      return fail(state, action.message);
    case "cancel-clicked": {
      const { kind } = state.session;
      if (kind !== "starting" && kind !== "running") return state;
      exec({ type: "cancel-calibration" });
      return { ...state, session: { kind: "meter" } };
    }
    case "back-to-meter-clicked":
      if (
        state.session.kind !== "result" &&
        state.session.kind !== "failed" &&
        state.session.kind !== "camera-busy"
      )
        return state;
      return { ...state, session: { kind: "meter" } };
    case "calibration-saved":
      if (
        state.session.kind !== "analysing" ||
        state.session.calibrationId !== action.calibrationId
      )
        return state;
      exec({ type: "refresh-history" });
      return showResult(state, action.calibration, true, exec);
    case "past-calibration-clicked": {
      if (!isSessionIdle(state.session)) return state;
      return showResult(state, action.calibration, action.latest, exec);
    }
    case "clap-step-loaded":
    case "clap-step-not-loaded": {
      const session = state.session;
      if (
        session.kind !== "result" ||
        session.calibration.id !== action.calibrationId ||
        session.clapStep?.status !== "loading"
      )
        return state;
      if (action.type === "clap-step-not-loaded")
        return {
          ...state,
          session: {
            ...session,
            clapStep: { status: "failed", message: action.message },
          },
        };
      return {
        ...state,
        session: { ...session, clapStep: startingClapStep(action.data) },
      };
    }
    case "sound-handle-dragged":
    case "sound-arrow-clicked":
    case "video-handle-dragged":
    case "video-arrow-clicked":
    case "play-clicked":
    case "stop-clicked":
      return onClapStep(state, action);
    case "save-mic-offset-clicked": {
      const session = state.session;
      if (session.kind !== "result" || session.clapStep?.status !== "ready")
        return state;
      const step = session.clapStep;
      if (step.save.status === "saving") return state;
      const micOffsetMs = clapStepOffsetMs(step);
      exec({
        type: "save-mic-offset",
        calibrationId: session.calibration.id,
        micOffsetMs,
      });
      return {
        ...state,
        session: {
          ...session,
          clapStep: { ...step, save: { status: "saving", micOffsetMs } },
        },
      };
    }
    case "mic-offset-saved":
    case "mic-offset-not-saved": {
      const session = state.session;
      if (
        session.kind !== "result" ||
        session.calibration.id !== action.calibrationId ||
        session.clapStep?.status !== "ready" ||
        session.clapStep.save.status !== "saving"
      )
        return state;
      const step = session.clapStep;
      const asked = session.clapStep.save.micOffsetMs;
      if (action.type === "mic-offset-not-saved")
        return {
          ...state,
          session: {
            ...session,
            clapStep: {
              ...step,
              save: { status: "failed", message: action.message },
            },
          },
        };
      // The gate and the history read the stored row: reload them.
      exec({ type: "refresh-history" });
      return {
        ...state,
        session: {
          ...session,
          calibration: action.calibration,
          clapStep: {
            ...step,
            save: {
              status: "saved",
              micOffsetMs: action.calibration.micOffsetMs ?? asked,
            },
          },
        },
      };
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
      return fail(state, action.message);
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

/**
 * The claps to show now: during the clap step (hands up, then each clap),
 * every clap heard so far, each seen or not; null outside it.
 */
export const liveClaps = (state: State): ClapMark[] | null => {
  const now = currentStep(state);
  if (
    state.session.kind !== "running" ||
    (now?.step.kind !== "clap-ready" && now?.step.kind !== "clap")
  )
    return null;
  return state.session.claps;
};
