import type { EffectReducer } from "use-effect-reducer";
import type { TLStoreSnapshot } from "tldraw";
import type { Snapshot } from "./snapshot-list";

/**
 * Where the open diagram's head stands. Only a `ready` canvas holds the
 * stored head, so only a `ready` canvas may be edited or saved.
 */
export type HeadStatus = "loading" | "failed" | "ready";

/**
 * The Active Diagram page: loading a diagram's head onto the canvas, restoring
 * snapshots over it, preserving it, creating new diagrams, and the link to the
 * video editor. See docs/FRONTEND_STATE.md.
 */
export namespace diagramPlaygroundReducer {
  export interface State {
    editorMounted: boolean;
    /** The diagram the canvas holds or is loading; `null` until one loads. */
    head: { diagramId: string; status: HeadStatus } | null;
    /** A restore waiting on the "you'll lose the canvas" dialog. */
    pendingRestore: Snapshot | null;
    preserving: boolean;
    creating: boolean;
    videoEditorConnected: boolean;
    windowFocused: boolean;
    /** tldraw's Focus Mode, which hides the sidebar. The editor owns it. */
    isFocusMode: boolean;
    /** Whether the video editor last reported a recording in progress. */
    recording: boolean;
    /** Bumped whenever the snapshot timeline may have changed on the server. */
    timelineVersion: number;
  }

  export type Action =
    // Canvas lifecycle
    | { type: "editor-mounted"; diagramId: string | null; isFocusMode: boolean }
    | { type: "diagram-opened"; diagramId: string }
    /** The palette's search restore moved the open diagram's head on the server. */
    | { type: "head-moved-elsewhere"; diagramId: string }
    | { type: "retry-load-clicked" }
    | { type: "head-loaded"; diagramId: string; scene: TLStoreSnapshot | null }
    | { type: "head-load-failed"; diagramId: string }
    // Restore
    | {
        type: "restore-requested";
        snapshot: Snapshot;
        headIsCaptured: boolean;
        canvasIsEmpty: boolean;
        requestId: number;
      }
    | { type: "restore-dismissed" }
    | { type: "restore-confirmed"; snapshot: Snapshot }
    | { type: "restore-succeeded"; diagramId: string; snapshot: Snapshot }
    | { type: "restore-failed" }
    // Preserve
    | { type: "preserve-clicked" }
    | { type: "snapshot-preserved"; created: boolean }
    | {
        type: "preserve-failed";
        reason: "thumbnail-failed" | "empty-diagram" | "request-failed";
      }
    // Create
    | { type: "create-clicked" }
    | { type: "diagram-created"; diagramId: string }
    | { type: "create-failed" }
    // Video editor asks for a snapshot pinned to a clip
    | {
        type: "clip-snapshot-requested";
        clipId: string;
        diagramId: string;
        diagramName: string | null;
      }
    | {
        type: "clip-snapshot-taken";
        clipId: string;
        diagramName: string | null;
        snapshotId: string | null;
      }
    | {
        type: "clip-snapshot-failed";
        clipId: string;
        diagramName: string | null;
      }
    // Surroundings
    | { type: "video-editor-replied" }
    | { type: "video-editor-disconnected" }
    | { type: "video-editor-went-quiet" }
    | { type: "window-focused" }
    | { type: "window-blurred" }
    | { type: "focus-mode-changed"; isFocusMode: boolean }
    /**
     * The video editor says whether it is recording. It repeats this on every
     * heartbeat, so only a change is a recording starting or stopping.
     */
    | { type: "recording-status-reported"; recording: boolean };

  export type Effect =
    /**
     * Fetch `diagramId`'s head. With `saveOpenHeadFirst`, the head currently
     * open is saved before the canvas stops saving — leaving a diagram keeps
     * its edits; reloading the same one discards them.
     */
    | { type: "load-head"; diagramId: string; saveOpenHeadFirst: boolean }
    /** Put `scene` on the canvas as `diagramId`'s stored head; edits now save. */
    | { type: "show-head"; diagramId: string; scene: TLStoreSnapshot | null }
    /** Don't leave the previous diagram's shapes standing in for this one. */
    | { type: "clear-canvas" }
    | {
        type: "restore-snapshot";
        diagramId: string;
        snapshot: Snapshot;
        requestId: number | null;
      }
    /** The request was handed to the dialog; whoever asked can stop waiting. */
    | { type: "release-restore-request"; requestId: number }
    | { type: "preserve-snapshot"; diagramId: string }
    | { type: "create-diagram" }
    | { type: "go-to-diagram"; diagramId: string }
    | {
        type: "take-clip-snapshot";
        clipId: string;
        diagramId: string;
        diagramName: string | null;
      }
    | {
        type: "report-clip-snapshot";
        clipId: string;
        ok: boolean;
        snapshotId: string | null;
        diagramName: string | null;
      }
    | { type: "show-error"; message: string }
    /** Turn tldraw's Focus Mode on (sidebar hidden) or off (sidebar shown). */
    | { type: "set-focus-mode"; isFocusMode: boolean };
}

type State = diagramPlaygroundReducer.State;
type Action = diagramPlaygroundReducer.Action;
type Effect = diagramPlaygroundReducer.Effect;

export const createInitialDiagramPlaygroundState = (opts: {
  windowFocused: boolean;
}): State => ({
  editorMounted: false,
  head: null,
  pendingRestore: null,
  preserving: false,
  creating: false,
  videoEditorConnected: false,
  windowFocused: opts.windowFocused,
  isFocusMode: false,
  recording: false,
  timelineVersion: 0,
});

/** Anything but a loaded head is read-only, so no edit is made that can't be saved. */
export const isCanvasEditable = (state: State) =>
  state.head?.status === "ready";

const PRESERVE_ERRORS = {
  "thumbnail-failed": "Failed to render thumbnail",
  "empty-diagram": "Cannot preserve an empty diagram",
  "request-failed": "Failed to preserve snapshot",
} as const;

export const diagramPlaygroundReducer: EffectReducer<State, Action, Effect> = (
  state,
  action,
  exec
): State => {
  const startLoad = (from: State, diagramId: string): State => {
    const openId = from.head?.diagramId;
    exec({
      type: "load-head",
      diagramId,
      saveOpenHeadFirst: openId !== undefined && openId !== diagramId,
    });
    return {
      ...from,
      head: { diagramId, status: "loading" },
      timelineVersion: from.timelineVersion + 1,
    };
  };

  /** A result for a diagram the canvas has since moved away from. */
  const isStale = (diagramId: string) => state.head?.diagramId !== diagramId;

  switch (action.type) {
    case "editor-mounted": {
      const mounted: State = {
        ...state,
        editorMounted: true,
        isFocusMode: action.isFocusMode,
      };
      if (!action.diagramId) return mounted;
      // A fresh editor has an empty store, so even a remount loads the head.
      return startLoad(mounted, action.diagramId);
    }
    case "diagram-opened":
      if (!state.editorMounted) return state;
      if (state.head?.diagramId === action.diagramId) return state;
      return startLoad(state, action.diagramId);
    case "head-moved-elsewhere":
      if (!state.editorMounted) return state;
      return startLoad(state, action.diagramId);
    case "retry-load-clicked":
      if (!state.head) return state;
      return startLoad(state, state.head.diagramId);
    case "head-loaded":
      if (isStale(action.diagramId)) return state;
      exec({
        type: "show-head",
        diagramId: action.diagramId,
        scene: action.scene,
      });
      return {
        ...state,
        head: { diagramId: action.diagramId, status: "ready" },
      };
    case "head-load-failed":
      if (isStale(action.diagramId)) return state;
      exec({ type: "clear-canvas" });
      return {
        ...state,
        head: { diagramId: action.diagramId, status: "failed" },
      };

    case "restore-requested": {
      if (!state.head) {
        exec({ type: "release-restore-request", requestId: action.requestId });
        return state;
      }
      if (action.headIsCaptured || action.canvasIsEmpty) {
        exec({
          type: "restore-snapshot",
          diagramId: state.head.diagramId,
          snapshot: action.snapshot,
          requestId: action.requestId,
        });
        return state;
      }
      exec({ type: "release-restore-request", requestId: action.requestId });
      return { ...state, pendingRestore: action.snapshot };
    }
    case "restore-dismissed":
      return { ...state, pendingRestore: null };
    case "restore-confirmed":
      if (!state.head) return state;
      exec({
        type: "restore-snapshot",
        diagramId: state.head.diagramId,
        snapshot: action.snapshot,
        requestId: null,
      });
      return { ...state, pendingRestore: null };
    case "restore-succeeded":
      if (isStale(action.diagramId)) return state;
      // The server has already moved the head to this snapshot.
      exec({
        type: "show-head",
        diagramId: action.diagramId,
        scene: action.snapshot.scene as TLStoreSnapshot,
      });
      return {
        ...state,
        head: { diagramId: action.diagramId, status: "ready" },
        timelineVersion: state.timelineVersion + 1,
      };
    case "restore-failed":
      exec({ type: "show-error", message: "Failed to restore snapshot" });
      return state;

    case "preserve-clicked":
      if (state.preserving || !state.head) return state;
      exec({ type: "preserve-snapshot", diagramId: state.head.diagramId });
      return { ...state, preserving: true };
    case "snapshot-preserved":
      return {
        ...state,
        preserving: false,
        timelineVersion: state.timelineVersion + (action.created ? 1 : 0),
      };
    case "preserve-failed":
      exec({ type: "show-error", message: PRESERVE_ERRORS[action.reason] });
      return { ...state, preserving: false };

    case "create-clicked":
      if (state.creating) return state;
      exec({ type: "create-diagram" });
      return { ...state, creating: true };
    case "diagram-created":
      exec({ type: "go-to-diagram", diagramId: action.diagramId });
      return { ...state, creating: false };
    case "create-failed":
      exec({ type: "show-error", message: "Failed to create diagram" });
      return { ...state, creating: false };

    case "clip-snapshot-requested":
      if (!state.editorMounted || isStale(action.diagramId)) {
        exec({
          type: "report-clip-snapshot",
          clipId: action.clipId,
          ok: false,
          snapshotId: null,
          diagramName: action.diagramName,
        });
        return state;
      }
      exec({
        type: "take-clip-snapshot",
        clipId: action.clipId,
        diagramId: action.diagramId,
        diagramName: action.diagramName,
      });
      return state;
    case "clip-snapshot-taken":
      exec({
        type: "report-clip-snapshot",
        clipId: action.clipId,
        ok: true,
        snapshotId: action.snapshotId,
        diagramName: action.diagramName,
      });
      return { ...state, timelineVersion: state.timelineVersion + 1 };
    case "clip-snapshot-failed":
      exec({
        type: "report-clip-snapshot",
        clipId: action.clipId,
        ok: false,
        snapshotId: null,
        diagramName: action.diagramName,
      });
      return state;

    case "video-editor-replied":
      return { ...state, videoEditorConnected: true };
    case "video-editor-disconnected":
    case "video-editor-went-quiet":
      return { ...state, videoEditorConnected: false };
    case "window-focused":
      return { ...state, windowFocused: true };
    case "window-blurred":
      return { ...state, windowFocused: false };
    case "focus-mode-changed":
      return { ...state, isFocusMode: action.isFocusMode };
    case "recording-status-reported":
      if (action.recording === state.recording) return state;
      // The window is the recording surface: the sidebar gets out of the way
      // when a recording starts and comes back when it stops. Between the two,
      // the author can still toggle it by hand.
      exec({ type: "set-focus-mode", isFocusMode: action.recording });
      return { ...state, recording: action.recording };
  }
};
