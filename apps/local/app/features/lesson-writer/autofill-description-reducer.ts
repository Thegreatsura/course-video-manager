import type { EffectReducer } from "use-effect-reducer";

/**
 * The SEO Description modal: the Video's description loaded fresh on open,
 * an Autofill written from the lesson body alone (run by itself when the
 * description is blank and the body is not), and Save. See
 * docs/FRONTEND_STATE.md.
 */
export namespace autofillDescriptionReducer {
  export interface State {
    status: "unloaded" | "loading" | "ready" | "failed";
    description: string;
    /** No lesson body to autofill from, so the Autofill is disabled. */
    bodyIsEmpty: boolean;
    autofilling: boolean;
    autofillError: string | null;
  }

  export type Action =
    | { type: "modal-opened"; videoId: string }
    | {
        type: "lesson-writer-data-loaded";
        videoId: string;
        description: string | null;
        body: string | null;
      }
    | { type: "lesson-writer-data-load-failed" }
    | { type: "description-edited"; description: string }
    | { type: "autofill-clicked"; videoId: string }
    | { type: "autofill-succeeded"; text: string }
    | { type: "autofill-failed"; error: string }
    | { type: "save-clicked"; videoId: string };

  export type Effect =
    | { type: "load-lesson-writer-data"; videoId: string }
    | { type: "autofill-description"; videoId: string }
    | { type: "save-description"; videoId: string; description: string }
    | { type: "close-modal" };
}

export const createInitialAutofillDescriptionState =
  (): autofillDescriptionReducer.State => ({
    status: "unloaded",
    description: "",
    bodyIsEmpty: false,
    autofilling: false,
    autofillError: null,
  });

const autofill = (
  state: autofillDescriptionReducer.State,
  videoId: string,
  exec: (effect: autofillDescriptionReducer.Effect) => unknown
): autofillDescriptionReducer.State => {
  exec({ type: "autofill-description", videoId });
  return { ...state, autofilling: true };
};

export const autofillDescriptionReducer: EffectReducer<
  autofillDescriptionReducer.State,
  autofillDescriptionReducer.Action,
  autofillDescriptionReducer.Effect
> = (state, action, exec) => {
  switch (action.type) {
    case "modal-opened":
      // The modal mounts per open, so it loads once per mount.
      if (state.status !== "unloaded") return state;
      exec({ type: "load-lesson-writer-data", videoId: action.videoId });
      return { ...state, status: "loading" };
    case "lesson-writer-data-loaded": {
      if (state.status !== "loading") return state;
      const description = action.description ?? "";
      const bodyIsEmpty = !(action.body ?? "").trim();
      const ready: autofillDescriptionReducer.State = {
        ...state,
        status: "ready",
        description,
        bodyIsEmpty,
      };
      return !description.trim() && !bodyIsEmpty
        ? autofill(ready, action.videoId, exec)
        : ready;
    }
    case "lesson-writer-data-load-failed":
      return state.status === "loading"
        ? { ...state, status: "failed" }
        : state;
    case "description-edited":
      if (state.autofilling) return state;
      return { ...state, description: action.description };
    case "autofill-clicked":
      if (state.status !== "ready" || state.bodyIsEmpty || state.autofilling) {
        return state;
      }
      return autofill(state, action.videoId, exec);
    case "autofill-succeeded":
      // A finished Autofill always replaces what is in the box.
      return {
        ...state,
        autofilling: false,
        description: action.text,
        autofillError: null,
      };
    case "autofill-failed":
      return { ...state, autofilling: false, autofillError: action.error };
    case "save-clicked":
      if (state.status !== "ready" || state.autofilling) return state;
      exec({
        type: "save-description",
        videoId: action.videoId,
        description: state.description,
      });
      exec({ type: "close-modal" });
      return state;
  }
};
