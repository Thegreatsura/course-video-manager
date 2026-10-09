import type { EffectReducer } from "use-effect-reducer";

/**
 * The Duplicate Course modal (`components/duplicate-course-modal.tsx`).
 * Duplicating is a `duplicate-course` Job: the request only checks the name
 * and enqueues it, so the modal closes as soon as it is answered and the
 * Job's row in the Upload Manager shows the copy, linking to it once it is
 * done. A failure after that is the Job's, and toasts. See
 * docs/FRONTEND_STATE.md.
 */
export namespace duplicateCourseReducer {
  export type State =
    | { status: "idle" }
    | { status: "submitting" }
    | { status: "error"; message: string };

  export type Action =
    | {
        type: "duplicate-pressed";
        courseId: string;
        name: string;
        currentName: string;
      }
    | { type: "duplicate-enqueued" }
    | { type: "duplicate-refused"; message: string }
    | { type: "modal-closed" };

  export type Effect =
    | { type: "request-duplicate"; courseId: string; name: string }
    | { type: "close-modal" };
}

export const createInitialDuplicateCourseState =
  (): duplicateCourseReducer.State => ({ status: "idle" });

export const duplicateCourseReducer: EffectReducer<
  duplicateCourseReducer.State,
  duplicateCourseReducer.Action,
  duplicateCourseReducer.Effect
> = (state, action, exec) => {
  switch (action.type) {
    case "duplicate-pressed": {
      if (state.status === "submitting") return state;
      const name = action.name.trim();
      if (!name) {
        return { status: "error", message: "Course name cannot be empty" };
      }
      if (name === action.currentName) {
        return {
          status: "error",
          message: "New course name must differ from the original",
        };
      }
      exec({ type: "request-duplicate", courseId: action.courseId, name });
      return { status: "submitting" };
    }
    case "duplicate-enqueued":
      exec({ type: "close-modal" });
      return { status: "idle" };
    case "duplicate-refused":
      return { status: "error", message: action.message };
    case "modal-closed":
      return { status: "idle" };
  }
};
