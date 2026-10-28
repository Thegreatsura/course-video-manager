import type { EffectReducer } from "use-effect-reducer";
import { readStored, writeStored } from "@/hooks/use-local-storage";

/**
 * The Lesson Body writer's "More?": a chain of Lesson Bodies written one
 * after another. Apply with "More?" ticked saves the Body, then asks the
 * server for the next Video with an empty Lesson Body and moves the writer
 * there; the writer below is keyed on `videoId`, so it starts fresh. "More?"
 * is the one thing that outlives a Video. Closing the writer by hand ends the
 * chain.
 *
 * "More?" is also remembered across opens and reloads: one global
 * localStorage key, read when the chain starts and written on every toggle.
 */
export namespace lessonBodyChainReducer {
  export type State = {
    /** The Video the writer is on now. */
    videoId: string;
    more: boolean;
  };

  export type Action =
    | { type: "more-toggled"; checked: boolean }
    /** Apply's save is confirmed. */
    | { type: "body-applied"; videoId: string }
    | {
        type: "next-video-found";
        fromVideoId: string;
        nextVideoId: string | null;
      }
    | { type: "next-video-lookup-failed"; fromVideoId: string }
    | { type: "writer-closed-by-hand" };

  export type Effect =
    | { type: "find-next-video"; videoId: string }
    | { type: "close-writer" }
    | { type: "persist-more"; more: boolean }
    | { type: "show-toast"; tone: "info" | "error"; message: string };
}

export const NO_MORE_VIDEOS_MESSAGE =
  "No more Videos with an empty Lesson Body";

/** One key for every Video: "More?" is a habit, not a per-Video setting. */
export const MORE_STORAGE_KEY = "lesson-body-writer-more";

export function createInitialLessonBodyChainState(
  videoId: string
): lessonBodyChainReducer.State {
  // Off unless "true" was stored: a missing or unreadable key reads as off.
  return { videoId, more: readStored(MORE_STORAGE_KEY) === "true" };
}

export function writeStoredMore(more: boolean): void {
  writeStored(MORE_STORAGE_KEY, String(more));
}

export const lessonBodyChainReducer: EffectReducer<
  lessonBodyChainReducer.State,
  lessonBodyChainReducer.Action,
  lessonBodyChainReducer.Effect
> = (state, action, exec) => {
  switch (action.type) {
    case "more-toggled":
      exec({ type: "persist-more", more: action.checked });
      return { ...state, more: action.checked };

    case "body-applied":
      if (action.videoId !== state.videoId) return state;
      if (state.more) {
        exec({ type: "find-next-video", videoId: state.videoId });
      } else {
        exec({ type: "close-writer" });
      }
      return state;

    case "next-video-found":
      // A late answer for a Video the writer has since left.
      if (action.fromVideoId !== state.videoId) return state;
      if (action.nextVideoId === null) {
        exec({ type: "close-writer" });
        exec({
          type: "show-toast",
          tone: "info",
          message: NO_MORE_VIDEOS_MESSAGE,
        });
        return state;
      }
      return { ...state, videoId: action.nextVideoId };

    case "next-video-lookup-failed":
      if (action.fromVideoId !== state.videoId) return state;
      // The Body is saved; only the hop failed. Close as a plain Apply would.
      exec({ type: "close-writer" });
      exec({
        type: "show-toast",
        tone: "error",
        message: "Saved, but could not find the next Video",
      });
      return state;

    case "writer-closed-by-hand":
      exec({ type: "close-writer" });
      return state;
  }
};
