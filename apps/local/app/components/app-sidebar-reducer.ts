import type { EffectReducer } from "use-effect-reducer";

/**
 * The app sidebar: which of its dialogs is open, the mobile navigation sheet,
 * and creating a Diagram from its **+** button. See docs/FRONTEND_STATE.md.
 */
export namespace appSidebarReducer {
  /** The sidebar's dialogs. Only one is open at a time. */
  export type Modal = "add-course" | "add-video" | "spacedesk";

  export interface State {
    openModal: Modal | null;
    /**
     * The mobile navigation sheet. Kept apart from `openModal` because a
     * dialog opened from inside the sheet stacks on top of it, and closing the
     * dialog leaves the sheet where it was.
     */
    sheetOpen: boolean;
    /** A create request is in flight; the Diagrams **+** is disabled. */
    creatingDiagram: boolean;
  }

  export type Action =
    | { type: "add-course-clicked" }
    | { type: "add-video-clicked" }
    | { type: "spacedesk-clicked" }
    /** A dialog asked to close (Escape, overlay click, Cancel, or done). */
    | { type: "modal-dismissed"; modal: Modal }
    | { type: "menu-button-clicked" }
    | { type: "sheet-dismissed" }
    /** The URL's path or query changed: the user navigated somewhere. */
    | { type: "location-changed" }
    | { type: "create-diagram-clicked" }
    | { type: "diagram-created"; diagramId: string }
    | { type: "diagram-create-failed" };

  export type Effect =
    | { type: "create-diagram" }
    | { type: "open-diagram"; diagramId: string }
    | { type: "show-error"; message: string };
}

export const createInitialAppSidebarState = (): appSidebarReducer.State => ({
  openModal: null,
  sheetOpen: false,
  creatingDiagram: false,
});

export const appSidebarReducer: EffectReducer<
  appSidebarReducer.State,
  appSidebarReducer.Action,
  appSidebarReducer.Effect
> = (state, action, exec) => {
  switch (action.type) {
    case "add-course-clicked":
      return { ...state, openModal: "add-course" };
    case "add-video-clicked":
      return { ...state, openModal: "add-video" };
    case "spacedesk-clicked":
      return { ...state, openModal: "spacedesk" };
    case "modal-dismissed":
      // A late close from a dialog that has already been replaced must not
      // shut the one now on screen.
      if (state.openModal !== action.modal) return state;
      return { ...state, openModal: null };
    case "menu-button-clicked":
      return { ...state, sheetOpen: true };
    case "sheet-dismissed":
    case "location-changed":
      if (!state.sheetOpen) return state;
      return { ...state, sheetOpen: false };
    case "create-diagram-clicked":
      if (state.creatingDiagram) return state;
      exec({ type: "create-diagram" });
      return { ...state, creatingDiagram: true };
    case "diagram-created":
      exec({ type: "open-diagram", diagramId: action.diagramId });
      return { ...state, creatingDiagram: false };
    case "diagram-create-failed":
      exec({ type: "show-error", message: "Failed to create diagram" });
      return { ...state, creatingDiagram: false };
  }
};
