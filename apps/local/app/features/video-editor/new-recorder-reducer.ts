import type { EffectReducer } from "use-effect-reducer";
import type { InsertionPoint } from "@/services/clip-service";
import type { SilenceLength } from "@/silence-detection-constants";
import type { FramesLost } from "recorder-service/protocol";
import type { NewRecorderMessage } from "./new-recorder-wire";

/**
 * The New recorder's Record and Stop in the editor. The recorder service
 * records; this follows what the app server reports of it (`recorder-message-
 * heard`) and asks for Record and Stop. Whatever started a recording, the
 * editor shows what the recorder says.
 */
export namespace newRecorderReducer {
  export type Phase = "idle" | "starting" | "recording" | "stopping";

  export type State = {
    /** Null until the app server first says. */
    reachable: boolean | null;
    /** Why the recorder cannot record at all (a wrong ffmpeg). */
    problem: string | null;
    phase: Phase;
    speaking: boolean;
    /** The last thing that went wrong, until the next Record. */
    error: string | null;
    /**
     * Something Matt must see at once (the camera lost mid-recording, a
     * Recording Session cut off by a crash), until he dismisses it.
     */
    alert: string | null;
    /** The last Recording Session's frames lost, until the next Record. */
    framesLost: FramesLost | null;
  };

  export type Action =
    | { type: "recorder-message-heard"; message: NewRecorderMessage }
    | {
        type: "press-record";
        silenceLength: SilenceLength;
        insertionPoint: InsertionPoint;
      }
    | { type: "press-stop" }
    | { type: "dismiss-alert" }
    | { type: "start-recording-failed"; message: string }
    | { type: "stop-recording-failed"; message: string };

  export type Effect =
    | {
        type: "start-recording";
        silenceLength: SilenceLength;
        insertionPoint: InsertionPoint;
      }
    | { type: "stop-recording" };
}

export const createInitialNewRecorderState = (): newRecorderReducer.State => ({
  reachable: null,
  problem: null,
  phase: "idle",
  speaking: false,
  error: null,
  alert: null,
  framesLost: null,
});

export const CAMERA_LOST_ALERT =
  "The Cam Link stopped sending video, so recording stopped. Everything up to then is kept, Clips included. Check its USB cable, or unplug and replug it, then press Record to carry on.";

export const CRASHED_ALERT =
  "The recorder crashed during the last recording. Its files were repaired and the Clips up to the crash are kept. Press Record to carry on.";

export const canRecord = (state: newRecorderReducer.State) =>
  state.reachable === true && state.problem === null && state.phase === "idle";

export const canStop = (state: newRecorderReducer.State) =>
  state.phase === "recording";

const heard = (
  state: newRecorderReducer.State,
  message: NewRecorderMessage
): newRecorderReducer.State => {
  switch (message.type) {
    case "recorder-status": {
      const recording = message.recordingSessionId !== null;
      return {
        ...state,
        reachable: message.reachable,
        problem: message.problem,
        phase: recording
          ? state.phase === "stopping"
            ? "stopping"
            : "recording"
          : state.phase === "starting"
            ? "starting"
            : "idle",
        speaking: recording && state.speaking,
      };
    }
    case "recording-started":
      return { ...state, phase: "recording", speaking: false, error: null };
    case "speech-started":
      return { ...state, speaking: true };
    case "speech-ended":
      return { ...state, speaking: false };
    case "camera-lost":
      return {
        ...state,
        phase: "idle",
        speaking: false,
        alert: CAMERA_LOST_ALERT,
        error: message.errors.length > 0 ? message.errors.join("\n") : null,
      };
    case "recording-stopped":
      return {
        ...state,
        phase: "idle",
        speaking: false,
        error:
          message.errors.length > 0 ? message.errors.join("\n") : state.error,
        alert: message.crashed ? CRASHED_ALERT : state.alert,
        framesLost: message.framesLost,
      };
    case "recorder-failed":
      return { ...state, error: message.message };
    case "clips-saved":
      return state;
  }
};

export const newRecorderReducer: EffectReducer<
  newRecorderReducer.State,
  newRecorderReducer.Action,
  newRecorderReducer.Effect
> = (state, action, exec) => {
  switch (action.type) {
    case "recorder-message-heard":
      return heard(state, action.message);
    case "press-record":
      if (!canRecord(state)) return state;
      exec({
        type: "start-recording",
        silenceLength: action.silenceLength,
        insertionPoint: action.insertionPoint,
      });
      return {
        ...state,
        phase: "starting",
        error: null,
        alert: null,
        framesLost: null,
      };
    case "dismiss-alert":
      return { ...state, alert: null };
    case "press-stop":
      if (!canStop(state)) return state;
      exec({ type: "stop-recording" });
      return { ...state, phase: "stopping" };
    case "start-recording-failed":
      return {
        ...state,
        phase: state.phase === "starting" ? "idle" : state.phase,
        error: action.message,
      };
    case "stop-recording-failed":
      return {
        ...state,
        phase: state.phase === "stopping" ? "recording" : state.phase,
        error: action.message,
      };
  }
};
