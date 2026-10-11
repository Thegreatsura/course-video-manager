import { useEffect, useRef, type RefObject } from "react";
import { useEffectReducer } from "use-effect-reducer";
import type { SilenceLength } from "@/silence-detection-constants";
import { savedItemBefore } from "./clip-state-reducer-new-recorder";
import type {
  ClipReducerAction,
  ClipReducerState,
} from "./clip-state-reducer.types";
import {
  canRecord,
  canRetryCamera,
  canStop,
  createInitialNewRecorderState,
  newRecorderReducer,
} from "./new-recorder-reducer";
import {
  NEW_RECORDER_MESSAGE_TYPES,
  type NewRecorderMessage,
} from "./new-recorder-wire";

/** What the editor's New recorder controls show and do. */
export type NewRecorderControls = {
  state: newRecorderReducer.State;
  canRecord: boolean;
  canStop: boolean;
  canRetryCamera: boolean;
  onRecord: () => void;
  onStop: () => void;
  onRetryCamera: () => void;
};

const answer = async (response: Response) => {
  if (!response.ok) throw new Error(await response.text());
};

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/**
 * Hears a Video's `NewRecorderMessage`s from `GET /api/videos/:id/recorder/
 * events` while `enabled`. Listening is what opens the recorder (and the Cam
 * Link) for that Video, so only a New recorder Video may listen. The editor
 * and the thumbnail camera both listen through here.
 */
export const useRecorderEvents = (
  videoId: string,
  enabled: boolean,
  onMessage: (message: NewRecorderMessage) => void
) => {
  const listener = useRef(onMessage);
  listener.current = onMessage;
  useEffect(() => {
    if (!enabled) return;
    const source = new EventSource(`/api/videos/${videoId}/recorder/events`);
    for (const type of NEW_RECORDER_MESSAGE_TYPES) {
      source.addEventListener(type, (event) => {
        listener.current(JSON.parse(event.data) as NewRecorderMessage);
      });
    }
    return () => source.close();
  }, [videoId, enabled]);
};

/**
 * The effect runner for `newRecorderReducer`, and the bridge from the app
 * server's recorder events (`GET /api/videos/:id/recorder/events`) into it
 * and into the clip reducer. Listens only on a New recorder Video, and its
 * listening is what opens the recorder (and the Cam Link) for that Video:
 * an OBS Video never opens it.
 */
export const useNewRecorder = (o: {
  videoId: string;
  enabled: boolean;
  silenceLength: SilenceLength;
  clipStateRef: RefObject<ClipReducerState>;
  clipDispatch: (action: ClipReducerAction) => void;
}): NewRecorderControls => {
  const { videoId } = o;
  const [state, dispatch] = useEffectReducer(
    newRecorderReducer,
    createInitialNewRecorderState,
    {
      "start-recording": (_state, effect, dispatch) => {
        fetch(`/api/videos/${videoId}/recorder/record`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            silenceLength: effect.silenceLength,
            insertionPoint: effect.insertionPoint,
          }),
        })
          .then(answer)
          .catch((error: unknown) =>
            dispatch({
              type: "start-recording-failed",
              message: messageOf(error),
            })
          );
      },
      "retry-camera": (_state, _effect, dispatch) => {
        fetch(`/api/videos/${videoId}/recorder/retry-camera`, {
          method: "POST",
        })
          .then(answer)
          .catch((error: unknown) =>
            dispatch({ type: "retry-camera-failed", message: messageOf(error) })
          );
      },
      "stop-recording": (_state, _effect, dispatch) => {
        fetch(`/api/videos/${videoId}/recorder/stop`, { method: "POST" })
          .then(answer)
          .catch((error: unknown) =>
            dispatch({
              type: "stop-recording-failed",
              message: messageOf(error),
            })
          );
      },
    }
  );

  useRecorderEvents(videoId, o.enabled, (message) => {
    dispatch({ type: "recorder-message-heard", message });
    o.clipDispatch({
      type: "new-recorder-message-heard",
      message,
      receivedAt: Date.now(),
    });
  });

  return {
    state,
    canRecord: canRecord(state),
    canStop: canStop(state),
    canRetryCamera: canRetryCamera(state),
    onRecord: () =>
      dispatch({
        type: "press-record",
        silenceLength: o.silenceLength,
        insertionPoint: savedItemBefore(o.clipStateRef.current),
      }),
    onStop: () => dispatch({ type: "press-stop" }),
    onRetryCamera: () => dispatch({ type: "press-retry" }),
  };
};
