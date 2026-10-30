import type { EffectReducer } from "use-effect-reducer";

/**
 * One preloaded Clip in the video editor's player (`preloadable-clip.tsx`).
 *
 * A Clip mounts preloading: its `<video>` plays muted through the short
 * window before the Clip's start, so the browser has buffered it by the time
 * it is shown. The `<video>` reporting that it reached the Clip's start is
 * `clip-preloaded`, which parks it there (paused, sound back on) once.
 *
 * The Clip also keeps its own clip-relative playhead for the Overlay preview
 * (`overlayTime`), heard as `playhead-moved` from the `<video>`'s frames,
 * seeks and time updates.
 */
export namespace preloadableClipReducer {
  export type State = {
    preload: "preloading" | "finished";
    /** Seconds into the Clip, for the Overlay preview. */
    overlayTime: number;
  };

  export type Action =
    /** The preloading `<video>` reached `at`, the Clip's start on its clock. */
    | { type: "clip-preloaded"; at: number }
    | { type: "playhead-moved"; clipTime: number };

  /** `park-video` pauses the `<video>` at `at` on its clock, sound back on. */
  export type Effect =
    { type: "park-video"; at: number } | { type: "report-preload-complete" };
}

type State = preloadableClipReducer.State;
type Action = preloadableClipReducer.Action;
type Effect = preloadableClipReducer.Effect;

export const createInitialPreloadableClipState = (): State => ({
  preload: "preloading",
  overlayTime: 0,
});

export const preloadableClipReducer: EffectReducer<State, Action, Effect> = (
  state,
  action,
  exec
) => {
  switch (action.type) {
    case "clip-preloaded":
      if (state.preload === "finished") return state;
      exec({ type: "park-video", at: action.at });
      exec({ type: "report-preload-complete" });
      return { ...state, preload: "finished" };
    case "playhead-moved":
      if (state.overlayTime === action.clipTime) return state;
      return { ...state, overlayTime: action.clipTime };
  }
};
