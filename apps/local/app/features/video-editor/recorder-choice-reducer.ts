import type { EffectReducer } from "use-effect-reducer";
import {
  recordersForFormat,
  resolveVideoRecorder,
  type VideoRecorder,
} from "@cvm/core/features/videos/recorder";
import type { RecordingSession, TimelineItem } from "./clip-state-reducer";
import type { OBSConnectionOuterState } from "./obs-connector";
import { isCaptureInProgress } from "./video-editor-selectors";

/**
 * The editor's choice of Recorder (OBS or CVM recorder) for one Video. The
 * choice is saved on the Video and, once saved, remembered as the last
 * choice, which a new Video then starts with (`last-recorder-choice.ts`).
 */
export namespace recorderChoiceReducer {
  export type State = {
    /** The Recorders this Video may record with (`recordersForFormat`). */
    options: readonly VideoRecorder[];
    /** The Recorder shown, and the one the editor records with. */
    recorder: VideoRecorder;
    /** The Recorder the Video last saved, to fall back to if a save fails. */
    saved: VideoRecorder;
    error: string | null;
  };

  export type Action =
    | {
        type: "recorder-picked";
        recorder: VideoRecorder;
        /** `isRecorderLocked` when the pick was made. */
        locked: boolean;
      }
    | { type: "recorder-saved"; recorder: VideoRecorder }
    | {
        type: "recorder-save-failed";
        recorder: VideoRecorder;
        message: string;
      };

  export type Effect =
    | { type: "save-recorder"; recorder: VideoRecorder }
    | { type: "remember-recorder-choice"; recorder: VideoRecorder };
}

export const createInitialRecorderChoiceState = (video: {
  format: string;
  recorder: string | null;
}): recorderChoiceReducer.State => {
  const options = recordersForFormat(video.format);
  const resolved = resolveVideoRecorder(video.recorder);
  const recorder = options.includes(resolved) ? resolved : "obs";
  return { options, recorder, saved: recorder, error: null };
};

export const recorderChoiceReducer: EffectReducer<
  recorderChoiceReducer.State,
  recorderChoiceReducer.Action,
  recorderChoiceReducer.Effect
> = (state, action, exec) => {
  switch (action.type) {
    case "recorder-picked": {
      if (
        action.locked ||
        action.recorder === state.recorder ||
        !state.options.includes(action.recorder)
      ) {
        return state;
      }
      exec({ type: "save-recorder", recorder: action.recorder });
      return { ...state, recorder: action.recorder, error: null };
    }
    case "recorder-saved":
      // Remembered only once the Video took it: a refused choice must not
      // become the Recorder the next new Video starts with.
      exec({ type: "remember-recorder-choice", recorder: action.recorder });
      return { ...state, saved: action.recorder };
    case "recorder-save-failed":
      if (action.recorder !== state.recorder) return state;
      return { ...state, recorder: state.saved, error: action.message };
  }
};

/**
 * Whether OBS drives this Video: only then does the editor connect to OBS and
 * show its checks (profile, scene name, Virtual Camera preview).
 */
export const showsOBSChecks = (state: recorderChoiceReducer.State): boolean =>
  state.recorder === "obs";

/**
 * Record, the scene buttons and the composite preview: only on a New
 * recorder Video.
 */
export const showsCvmRecorderControls = (
  state: Pick<recorderChoiceReducer.State, "recorder">
): boolean => state.recorder === "cvm";

/**
 * The Recorder is locked once the Video has a live Clip, so one Video never
 * mixes OBS and CVM-recorder Clips, and while a capture is still in progress
 * (its first Clip may not have landed yet). Archived Clips do not count: a
 * Video whose Clips are all archived has no Footage.
 */
export const isRecorderLocked = (
  obsConnectorState: OBSConnectionOuterState,
  items: TimelineItem[],
  sessions: RecordingSession[]
): boolean =>
  items.some(
    (item) =>
      item.type !== "chapter-on-database" &&
      item.type !== "chapter-optimistically-added" &&
      !("shouldArchive" in item && item.shouldArchive)
  ) || isCaptureInProgress(obsConnectorState, items, sessions);
