import type { EffectReducer } from "use-effect-reducer";
import type { ClipMockupCommentEvent } from "@/routes/api.clip-mockup-comments";

/**
 * One Clip Mockup Comment in its thread: editing it in place, and deleting
 * it. The comment's body comes in on the events as it is NOW, which a poll
 * may have changed since it first rendered. See docs/FRONTEND_STATE.md.
 */
export namespace animaticCommentEditReducer {
  export interface State {
    editing: boolean;
    draft: string;
  }

  export type Action =
    | { type: "edit-clicked"; body: string }
    | { type: "edit-draft-edited"; draft: string }
    /** Cmd/Ctrl+Enter or Save. */
    | { type: "edit-saved"; commentId: string; body: string }
    /** Escape or Cancel. */
    | { type: "edit-cancelled" }
    | { type: "delete-clicked"; commentId: string };

  export type Effect = { type: "write-comment"; event: ClipMockupCommentEvent };
}

export const createInitialAnimaticCommentEditState =
  (): animaticCommentEditReducer.State => ({ editing: false, draft: "" });

export const animaticCommentEditReducer: EffectReducer<
  animaticCommentEditReducer.State,
  animaticCommentEditReducer.Action,
  animaticCommentEditReducer.Effect
> = (state, action, exec) => {
  switch (action.type) {
    case "edit-clicked":
      return { editing: true, draft: action.body };
    case "edit-draft-edited":
      return { ...state, draft: action.draft };
    case "edit-saved": {
      const body = state.draft.trim();
      if (!state.editing || body === "") return state;
      if (body !== action.body) {
        exec({
          type: "write-comment",
          event: { type: "update", commentId: action.commentId, body },
        });
      }
      return { ...state, editing: false };
    }
    case "edit-cancelled":
      return { ...state, editing: false };
    case "delete-clicked":
      exec({
        type: "write-comment",
        event: { type: "delete", commentId: action.commentId },
      });
      return state;
  }
};
