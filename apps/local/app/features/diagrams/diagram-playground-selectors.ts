import type { diagramPlaygroundReducer } from "./diagram-playground-reducer";

/** Selectors over `diagramPlaygroundReducer.State` (docs/FRONTEND_STATE.md rule 6). */

type State = diagramPlaygroundReducer.State;

/** Anything but a loaded head is read-only, so no edit is made that can't be saved. */
export const isCanvasEditable = (state: State) =>
  state.head?.status === "ready";

/**
 * The canvas holds edits the server refused to save over a head changed
 * elsewhere. Leaving now would drop them, so they're kept as a snapshot first.
 */
export const mustKeepCanvasBeforeLeaving = (state: State) =>
  state.head?.status === "ready" &&
  state.head.changedElsewhere &&
  !state.head.keptAsSnapshot;

/**
 * What leaving the open diagram has to wait for: its pending edits saved, or
 * a canvas the server refused kept as a snapshot. `null` lets it go at once.
 * The navigation blocker asks this too, so it holds exactly what the reducer
 * would make wait.
 */
export const leaveMustWaitFor = (
  state: State,
  canvasHasUnsavedEdits: boolean
): "save" | "keep-canvas" | null => {
  if (mustKeepCanvasBeforeLeaving(state)) return "keep-canvas";
  // A refused canvas already kept, or waiting on the prompt, has no save to make.
  if (
    canvasHasUnsavedEdits &&
    state.head?.status === "ready" &&
    !state.head.changedElsewhere
  ) {
    return "save";
  }
  return null;
};
