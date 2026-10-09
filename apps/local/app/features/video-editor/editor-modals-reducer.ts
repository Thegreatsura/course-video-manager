import type { EffectReducer } from "use-effect-reducer";
import type { SuggestionState } from "./video-editor-context";

/**
 * The video editor's own dialogs and the inline next-line suggestion the
 * Suggestions panel streams. The chapter-naming and Autofill chapters dialogs
 * keep their own hooks. See docs/FRONTEND_STATE.md.
 */
export namespace editorModalsReducer {
  /** The editor's dialogs. Only one is open at a time. */
  export type Modal =
    | "add-video"
    | "paste-file"
    | "rename-video"
    | "copy-video"
    | "create-video-from-selection";

  export interface State {
    openModal: Modal | null;
    /** What the Suggestions panel last reported, shown under the timeline. */
    suggestion: SuggestionState;
  }

  export type Action =
    | { type: "add-video-to-lesson-clicked" }
    | { type: "add-note-from-clipboard-clicked" }
    | { type: "rename-video-clicked" }
    | { type: "copy-video-clicked" }
    | { type: "create-video-from-selection-clicked" }
    /** A dialog asked to close (Escape, overlay click, Cancel, or done). */
    | { type: "modal-dismissed"; modal: Modal }
    | { type: "suggestion-changed"; suggestion: SuggestionState };

  export type Effect =
    /** Re-run the route loaders so the video's file list is current. */
    { type: "refresh-video-files" };
}

export const createInitialEditorModalsState =
  (): editorModalsReducer.State => ({
    openModal: null,
    suggestion: {
      suggestionText: "",
      isStreaming: false,
      enabled: false,
      error: null,
      triggerSuggestion: () => {},
    },
  });

export const editorModalsReducer: EffectReducer<
  editorModalsReducer.State,
  editorModalsReducer.Action,
  editorModalsReducer.Effect
> = (state, action, exec) => {
  switch (action.type) {
    case "add-video-to-lesson-clicked":
      return { ...state, openModal: "add-video" };
    case "add-note-from-clipboard-clicked":
      return { ...state, openModal: "paste-file" };
    case "rename-video-clicked":
      return { ...state, openModal: "rename-video" };
    case "copy-video-clicked":
      return { ...state, openModal: "copy-video" };
    case "create-video-from-selection-clicked":
      return { ...state, openModal: "create-video-from-selection" };
    case "modal-dismissed":
      // Pasting a file writes it to disk, so the file list refreshes whenever
      // the paste dialog closes, whether or not it is still the open one.
      if (action.modal === "paste-file") {
        exec({ type: "refresh-video-files" });
      }
      // A late close from a dialog that has already been replaced must not
      // shut the one now on screen.
      if (state.openModal !== action.modal) return state;
      return { ...state, openModal: null };
    case "suggestion-changed":
      return { ...state, suggestion: action.suggestion };
  }
};
