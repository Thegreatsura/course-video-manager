import type { EffectReducer } from "use-effect-reducer";
import type { ClipMockupCommentEvent } from "@/routes/api.clip-mockup-comments";

export type AnimaticCommentTarget = Extract<
  ClipMockupCommentEvent,
  { type: "create" }
>["target"];

/**
 * One Clip Mockup Comment thread: whether its popover is open by its own
 * button, the target it froze as it opened, and the new comment being typed.
 * THE TARGET IS FROZEN WHILE THE THREAD IS OPEN, so a comment typed as the
 * Animatic plays on still lands on the moment it was opened on. See
 * docs/FRONTEND_STATE.md.
 */
export namespace animaticCommentThreadReducer {
  export interface State {
    /** Opened by its own button (a caller may hold it open instead). */
    ownOpen: boolean;
    /** What the thread is on, from the moment it showed until it hides. */
    openTarget: AnimaticCommentTarget | null;
    draft: string;
  }

  export type Action =
    /** The popover's own trigger, an outside click or Escape. */
    | { type: "popover-toggled"; open: boolean }
    /** The thread came on screen, however it was opened. */
    | { type: "thread-shown"; target: AnimaticCommentTarget }
    | { type: "thread-hidden" }
    | { type: "draft-edited"; draft: string }
    /** Cmd/Ctrl+Enter or the Comment button. */
    | { type: "comment-submitted" };

  export type Effect = { type: "write-comment"; event: ClipMockupCommentEvent };
}

export const createInitialAnimaticCommentThreadState =
  (): animaticCommentThreadReducer.State => ({
    ownOpen: false,
    openTarget: null,
    draft: "",
  });

/** The thread's target: the frozen one while open, else the caller's. */
export const selectThreadTarget = (
  state: animaticCommentThreadReducer.State,
  target: AnimaticCommentTarget
) => state.openTarget ?? target;

export const animaticCommentThreadReducer: EffectReducer<
  animaticCommentThreadReducer.State,
  animaticCommentThreadReducer.Action,
  animaticCommentThreadReducer.Effect
> = (state, action, exec) => {
  switch (action.type) {
    case "popover-toggled":
      return { ...state, ownOpen: action.open };
    case "thread-shown":
      if (state.openTarget) return state;
      return { ...state, openTarget: action.target };
    case "thread-hidden":
      return { ...state, openTarget: null };
    case "draft-edited":
      return { ...state, draft: action.draft };
    case "comment-submitted": {
      const body = state.draft.trim();
      if (body === "" || !state.openTarget) return state;
      exec({
        type: "write-comment",
        event: { type: "create", target: state.openTarget, body },
      });
      return { ...state, draft: "" };
    }
  }
};
