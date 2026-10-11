import { useEffectReducer } from "use-effect-reducer";
import type { VideoRecorder } from "@cvm/core/features/videos/recorder";
import {
  createInitialRecorderChoiceState,
  recorderChoiceReducer,
  showsOBSChecks,
} from "./recorder-choice-reducer";
import { rememberRecorderChoice } from "./last-recorder-choice";

/** What the editor's Recorder picker shows and does. */
export type RecorderPicker = {
  recorder: VideoRecorder;
  options: readonly VideoRecorder[];
  locked: boolean;
  error: string | null;
  onPick: (recorder: VideoRecorder) => void;
};

/** The effect runner for `recorderChoiceReducer`. */
export const useRecorderChoice = (video: {
  id: string;
  format: string;
  recorder: string | null;
}) => {
  const [state, dispatch] = useEffectReducer(
    recorderChoiceReducer,
    () => createInitialRecorderChoiceState(video),
    {
      "save-recorder": (_state, effect, dispatch) => {
        fetch(`/api/videos/${video.id}/recorder`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ recorder: effect.recorder }),
        })
          .then(async (response) => {
            if (!response.ok) throw new Error(await response.text());
            dispatch({ type: "recorder-saved", recorder: effect.recorder });
          })
          .catch((error: unknown) =>
            dispatch({
              type: "recorder-save-failed",
              recorder: effect.recorder,
              message: `Could not choose the Recorder: ${
                error instanceof Error ? error.message : String(error)
              }`,
            })
          );
      },
      "remember-recorder-choice": (_state, effect) => {
        rememberRecorderChoice(effect.recorder);
      },
    }
  );

  return { state, dispatch, usesObs: showsOBSChecks(state) };
};

export const toRecorderPicker = (
  choice: ReturnType<typeof useRecorderChoice>,
  locked: boolean
): RecorderPicker => ({
  recorder: choice.state.recorder,
  options: choice.state.options,
  locked,
  error: choice.state.error,
  onPick: (recorder) =>
    choice.dispatch({ type: "recorder-picked", recorder, locked }),
});
