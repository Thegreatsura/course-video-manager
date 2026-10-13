import { useEffect, useRef, type RefObject } from "react";
import { useEffectReducer } from "use-effect-reducer";
import type { Scene } from "@/packages/scene-layout";
import type { MicEq } from "@cvm/core/features/videos/recorder";
import {
  resolveVideoFormat,
  type VideoFormat,
} from "@/features/videos/video-format";
import {
  MINIMUM_CLIP_LENGTH_SECONDS,
  type SilenceLength,
} from "@/silence-detection-constants";
import { savedItemBefore } from "./clip-state-reducer-cvm-recorder";
import type {
  ClipReducerAction,
  ClipReducerState,
  FrontendId,
  MicOffsetRefusal,
} from "./clip-state-reducer.types";
import {
  canRecord,
  canRetryCamera,
  canStop,
  canSwitchScene,
  canWakeSpacedeskAgain,
  createInitialCvmRecorderState,
  cvmRecorderReducer,
} from "./cvm-recorder-reducer";
import {
  CVM_RECORDER_MESSAGE_TYPES,
  type CvmRecorderMessage,
} from "./cvm-recorder-wire";
import { isSceneAvailable } from "./cvm-recorder-screen";

/** What the editor's CVM recorder controls show and do. */
export type CvmRecorderControls = {
  state: cvmRecorderReducer.State;
  canRecord: boolean;
  canStop: boolean;
  canRetryCamera: boolean;
  canSwitchScene: boolean;
  /** A Short's screen scenes wait for its screen; Camera never does. */
  isSceneAvailable: (scene: Scene) => boolean;
  canWakeSpacedeskAgain: boolean;
  onWakeSpacedesk: () => void;
  onRecord: () => void;
  onScene: (scene: Scene) => void;
  onStop: () => void;
  onDismissAlert: () => void;
  onRetryCamera: () => void;
  /** Set (or, with null, clear) a saved CVM-recorder Clip's Scene Override. */
  onSetSceneOverride: (clipId: FrontendId, sceneOverride: Scene | null) => void;
  /** The Mic Settings dialog was saved on a CVM-recorder Clip. */
  onSubmitMicSettings: (
    clipId: FrontendId,
    settings: { micOffsetMs: number; micEq: MicEq }
  ) => void;
  /** A refused mic offset the Mic Settings dialog reopens to explain. */
  micOffsetRefusal: MicOffsetRefusal | null;
  onDismissMicOffsetRefusal: () => void;
};

const answer = async (response: Response) => {
  if (!response.ok) throw new Error(await response.text());
};

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/**
 * Hears a Video's `CvmRecorderMessage`s from `GET /api/videos/:id/recorder/
 * events` while `enabled`. Listening is what opens the recorder (and the Cam
 * Link) for that Video, so only a CVM recorder Video may listen. The editor
 * and the thumbnail camera both listen through here.
 */
export const useRecorderEvents = (
  videoId: string,
  enabled: boolean,
  onMessage: (message: CvmRecorderMessage) => void
) => {
  const listener = useRef(onMessage);
  listener.current = onMessage;
  useEffect(() => {
    if (!enabled) return;
    const source = new EventSource(`/api/videos/${videoId}/recorder/events`);
    for (const type of CVM_RECORDER_MESSAGE_TYPES) {
      source.addEventListener(type, (event) => {
        listener.current(JSON.parse(event.data) as CvmRecorderMessage);
      });
    }
    return () => source.close();
  }, [videoId, enabled]);
};

/**
 * The effect runner for `cvmRecorderReducer`, and the bridge from the app
 * server's recorder events (`GET /api/videos/:id/recorder/events`) into it
 * and into the clip reducer. Listens only on a CVM recorder Video, and its
 * listening is what opens the recorder (and the Cam Link) for that Video:
 * an OBS Video never opens it.
 */
export const useCvmRecorder = (o: {
  /** The Video: a Short opens the recorder, and draws, in the Short layout. */
  video: { id: string; format: string };
  enabled: boolean;
  silenceLength: SilenceLength;
  clipStateRef: RefObject<ClipReducerState>;
  clipDispatch: (action: ClipReducerAction) => void;
  micOffsetRefusal: MicOffsetRefusal | null;
}): CvmRecorderControls => {
  const videoId = o.video.id;
  const format: VideoFormat = resolveVideoFormat(o.video.format);
  const [state, dispatch] = useEffectReducer(
    cvmRecorderReducer,
    () => createInitialCvmRecorderState(format),
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
      "send-silence-length": (_state, effect) => {
        fetch(`/api/videos/${videoId}/recorder/silence-length`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ silenceLength: effect.silenceLength }),
        })
          .then(answer)
          .catch((error: unknown) =>
            // Not fatal: only a Stream Deck Record needs it, and says so.
            console.error(
              "Could not tell the recorder the Silence Length",
              error
            )
          );
      },
      "time-speech": (_state, effect, dispatch) => {
        const timer = setTimeout(
          () =>
            dispatch({
              type: "speech-long-enough",
              speechCount: effect.speechCount,
              recordingSessionId: effect.recordingSessionId,
            }),
          MINIMUM_CLIP_LENGTH_SECONDS * 1000
        );
        return () => clearTimeout(timer);
      },
      "start-take": (_state, effect) => {
        o.clipDispatch({
          type: "take-started",
          recordingSessionId: effect.recordingSessionId,
          soundDetectionId: effect.soundDetectionId,
          scene: null,
          profile: null,
          at: Date.now(),
        });
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
      "retry-screen": (_state, _effect, dispatch) => {
        fetch(`/api/videos/${videoId}/recorder/retry-screen`, {
          method: "POST",
        })
          .then(answer)
          .catch((error: unknown) =>
            dispatch({ type: "retry-screen-failed", message: messageOf(error) })
          );
      },
      "switch-scene": (_state, effect, dispatch) => {
        fetch(`/api/videos/${videoId}/recorder/scene`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scene: effect.scene }),
        })
          .then(answer)
          .catch((error: unknown) =>
            dispatch({ type: "switch-scene-failed", message: messageOf(error) })
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

  // Bridges the editor's Silence Length (a localStorage choice) in.
  useEffect(() => {
    if (o.enabled)
      dispatch({
        type: "silence-length-chosen",
        silenceLength: o.silenceLength,
      });
  }, [o.enabled, o.silenceLength, dispatch]);

  useRecorderEvents(videoId, o.enabled, (message) => {
    dispatch({ type: "recorder-message-heard", message });
    o.clipDispatch({
      type: "cvm-recorder-message-heard",
      message,
      receivedAt: Date.now(),
    });
  });

  return {
    state,
    canRecord: canRecord(state),
    canStop: canStop(state),
    canRetryCamera: canRetryCamera(state),
    canSwitchScene: canSwitchScene(state),
    isSceneAvailable: (scene) => isSceneAvailable(state, scene),
    canWakeSpacedeskAgain: canWakeSpacedeskAgain(state),
    onWakeSpacedesk: () => dispatch({ type: "press-wake-spacedesk" }),
    onRecord: () =>
      dispatch({
        type: "press-record",
        silenceLength: o.silenceLength,
        insertionPoint: savedItemBefore(o.clipStateRef.current),
      }),
    onStop: () => dispatch({ type: "press-stop" }),
    onScene: (scene) => dispatch({ type: "press-scene", scene }),
    onDismissAlert: () => dispatch({ type: "dismiss-alert" }),
    onRetryCamera: () => dispatch({ type: "press-retry" }),
    onSetSceneOverride: (clipId, sceneOverride) =>
      o.clipDispatch({ type: "set-scene-override", clipId, sceneOverride }),
    onSubmitMicSettings: (clipId, settings) =>
      o.clipDispatch({ type: "mic-settings-submitted", clipId, ...settings }),
    micOffsetRefusal: o.micOffsetRefusal,
    onDismissMicOffsetRefusal: () =>
      o.clipDispatch({ type: "mic-offset-refusal-dismissed" }),
  };
};
