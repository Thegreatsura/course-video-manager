import type { RecorderState } from "recorder-service/protocol";
import type { CvmRecorderMessage } from "@/features/video-editor/cvm-recorder-wire";

/**
 * What an editor on `videoId` hears of the recorder's state, as the recorder
 * client (`client.server.ts`) passes it on: the camera, the scene and a
 * Short's screen. Each is undefined when there is nothing to say.
 */

/** The camera, as an editor on `videoId` hears it, from the recorder's state. */
export const cameraMessage = (
  state: RecorderState,
  videoId: string
): CvmRecorderMessage | undefined => {
  if (state.kind === "recording" && state.videoId === videoId) return undefined;
  if (state.kind !== "open" || state.videoId !== videoId)
    return { type: "camera-closed" };
  const camera = state.camera;
  switch (camera.kind) {
    case "opening":
      return { type: "camera-opening", attempt: camera.attempt };
    case "live":
      return { type: "camera-went-live" };
    case "not-starting":
      return { type: "cam-link-not-starting", message: camera.message };
    case "busy":
      return { type: "cam-link-busy", message: camera.message };
  }
};

/** The scene, as an editor on `videoId` hears it, while the recorder is its. */
export const sceneMessage = (
  state: RecorderState,
  videoId: string
): CvmRecorderMessage | undefined =>
  state.kind !== "closed" && state.videoId === videoId
    ? { type: "scene-changed", scene: state.scene }
    : undefined;

/** A Short's screen, as an editor on `videoId` hears it, while the recorder is its. */
export const screenMessage = (
  state: RecorderState,
  videoId: string
): CvmRecorderMessage | undefined =>
  state.kind !== "closed" && state.videoId === videoId && state.screen
    ? { type: "screen-changed", screen: state.screen }
    : undefined;
