import { drawnSources, type Scene } from "@/packages/scene-layout";
import type { cvmRecorderReducer } from "./cvm-recorder-reducer";

/**
 * A Short's screen in the editor: the Spacedesk display the recorder wakes
 * when it opens for a Short. Until it is ready, a scene that draws the
 * screen can be neither switched to nor recorded in; Camera can, once the
 * wake has answered (the recorder refuses every Record while it wakes).
 * A Landscape Video's screen (the DELL) is checked by the recorder at Record,
 * so every Landscape scene is available here.
 */

/** Whether `scene` draws the screen in the Video's layout. */
export const sceneShowsScreen = (
  scene: Scene,
  format: cvmRecorderReducer.State["format"]
) => drawnSources([{ scene }], format).includes("screen");

/** Whether the recorder can draw `scene` now: a Short's screen scenes wait for the screen. */
export const isSceneAvailable = (
  state: Pick<cvmRecorderReducer.State, "format" | "screen">,
  scene: Scene
) =>
  state.format !== "short" ||
  !sceneShowsScreen(scene, state.format) ||
  state.screen?.kind === "ready";

/** A Short's Spacedesk wake has not answered yet: the recorder refuses Record until it has. */
export const isScreenWaking = (
  state: Pick<cvmRecorderReducer.State, "format" | "screen">
) => state.format === "short" && state.screen?.kind === "waking";

/** What the Short's screen is doing, for the status line; null when there is nothing to say. */
export const screenStatusText = (
  state: Pick<cvmRecorderReducer.State, "format" | "screen">
): string | null => {
  if (state.format !== "short" || !state.screen) return null;
  switch (state.screen.kind) {
    case "waking":
      return "Waking Spacedesk…";
    case "unavailable":
      return state.screen.message;
    case "ready":
      return null;
  }
};

/**
 * Why Record is off although the camera is live: the scene the recorder is in
 * draws a screen that is not ready. Null when that is not the reason.
 */
export const recordNeedsScreenHint = (
  state: cvmRecorderReducer.State
): string | null =>
  state.phase === "idle" &&
  state.camera.kind === "live" &&
  state.scene !== null &&
  !isScreenWaking(state) &&
  !isSceneAvailable(state, state.scene)
    ? `${state.scene} shows the screen, which is not ready: pick Camera to record without it.`
    : null;
