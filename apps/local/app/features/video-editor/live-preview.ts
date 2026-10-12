import type { Scene } from "@/packages/scene-layout";
import type { OBSConnectionOuterState } from "./obs-connector";
import type { newRecorderReducer } from "./new-recorder-reducer";
import type { FrontendSpeechDetectorState } from "./use-speech-detector";

/**
 * The editor's live frame, whichever Recorder the Video uses. OBS fills it
 * with its Virtual Camera; the New recorder with the composite drawn from its
 * MJPEG feeds. Either way it is the same frame: the same place on screen, the
 * same capture badge, ring, recording signal and centre line, and the
 * previous Clip's last frame over it.
 */

/** The New recorder's composite, as the live frame draws it. */
export type NewRecorderLivePreview = {
  previews: { camera: string; screen: string };
  scene: Scene;
  /** Whether the camera feed has anything to show (the Cam Link is live or recording). */
  cameraShowing: boolean;
  /** Changes when the camera comes back, so its stream reconnects. */
  cameraKey: string;
  /** The Camera scene gets OBS's framing guide. */
  showCenterLine: boolean;
};

/**
 * The composite the live frame draws, or null while the recorder has nothing
 * to show for this Video (not reachable, not open, scene not yet known).
 */
export const getNewRecorderLivePreview = (
  state: newRecorderReducer.State
): NewRecorderLivePreview | null => {
  if (state.reachable !== true || !state.previews || !state.scene) return null;
  return {
    previews: state.previews,
    scene: state.scene,
    cameraShowing: state.camera.kind === "live" || state.phase !== "idle",
    cameraKey: state.camera.kind,
    showCenterLine: state.scene === "Camera",
  };
};

/**
 * Is there a live picture? While there is, a paused editor shows it instead
 * of the Clip player, as it always has for OBS.
 */
export const getHasLivePreview = (
  liveMediaStream: MediaStream | null,
  newRecorder: newRecorderReducer.State
): boolean =>
  liveMediaStream !== null || getNewRecorderLivePreview(newRecorder) !== null;

/** Whether a take is under way, and what the capture badge says of it. */
export type RecorderCapture = {
  isRecordingActive: boolean;
  speechDetectorState: FrontendSpeechDetectorState;
};

/**
 * The New recorder's take in the browser speech detector's terms, so the
 * badge, the ring, the teleprompter and the Silence Length lock read it as
 * they read OBS's: warming up from Record until the recorder has started,
 * speaking while the recorder hears speech, silence otherwise. Under way
 * from Record until the recorder says it stopped.
 */
export const getNewRecorderCapture = (
  state: newRecorderReducer.State
): RecorderCapture => ({
  isRecordingActive: state.phase !== "idle",
  speechDetectorState:
    state.phase === "starting"
      ? { type: "warming-up" }
      : state.speaking
        ? { type: "speaking-detected" }
        : { type: "silence" },
});

/** The capture of whichever Recorder the Video uses. */
export const recorderCapture = (
  choice: { usesObs: boolean },
  obs: {
    state: OBSConnectionOuterState;
    speechDetectorState: FrontendSpeechDetectorState;
  },
  newRecorder: { state: newRecorderReducer.State }
): RecorderCapture =>
  choice.usesObs
    ? {
        isRecordingActive: obs.state.type === "obs-recording",
        speechDetectorState: obs.speechDetectorState,
      }
    : getNewRecorderCapture(newRecorder.state);
