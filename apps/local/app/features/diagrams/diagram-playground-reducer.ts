import type { EffectReducer } from "use-effect-reducer";
import type { TLStoreSnapshot } from "tldraw";
import type { Snapshot } from "./snapshot-list";

import type {
  CanvasHead,
  LeaveDestination,
  StatusError,
  StoredHead,
} from "./diagram-playground-reducer.types";

export * from "./diagram-playground-reducer.types";

/** How long an error stays in the status line if nothing succeeds first. */
export const STATUS_ERROR_MS = 8000;

/**
 * The Active Diagram page: loading a diagram's head onto the canvas, restoring
 * snapshots over it, preserving it, creating new diagrams, and the link to the
 * video editor. See docs/FRONTEND_STATE.md.
 */
export namespace diagramPlaygroundReducer {
  export interface State {
    editorMounted: boolean;
    /** The diagram the canvas holds or is loading; `null` until one loads. */
    head: CanvasHead | null;
    /** A restore waiting on the "you'll lose the canvas" dialog. */
    pendingRestore: Snapshot | null;
    preserving: boolean;
    /**
     * A navigation away from the open diagram is held while its canvas, which
     * the server won't take as the head, is kept as a preserved snapshot.
     */
    leaving: LeaveDestination | null;
    creating: boolean;
    videoEditorConnected: boolean;
    windowFocused: boolean;
    /** tldraw's Focus Mode, which hides the sidebar. The editor owns it. */
    isFocusMode: boolean;
    /** Whether the video editor last reported a recording in progress. */
    recording: boolean;
    /** Bumped whenever the snapshot timeline may have changed on the server. */
    timelineVersion: number;
    /** What the status line shows; `null` when nothing has gone wrong. */
    error: StatusError | null;
    /** Errors reported so far, so each gets its own `id`. */
    errorCount: number;
  }

  export type Action =
    // Canvas lifecycle
    | { type: "editor-mounted"; diagramId: string | null; isFocusMode: boolean }
    | { type: "diagram-opened"; diagramId: string }
    /** The palette's search restore moved the open diagram's head on the server. */
    | { type: "head-moved-elsewhere"; diagramId: string }
    | { type: "retry-load-clicked" }
    | {
        type: "head-loaded";
        diagramId: string;
        scene: TLStoreSnapshot | null;
        stored: StoredHead;
      }
    | { type: "head-load-failed"; diagramId: string }
    // Keeping in step with the stored head
    /**
     * The page refetched the Active Diagram's stored head. The canvas's own
     * unsaved edits ride along, since only the editor knows them.
     */
    | {
        type: "stored-head-reported";
        diagramId: string;
        stored: StoredHead;
        canvasHasUnsavedEdits: boolean;
      }
    | { type: "head-save-started"; diagramId: string }
    | { type: "head-saved"; diagramId: string; stored: StoredHead }
    | { type: "head-save-failed"; diagramId: string }
    /** The server refused the save: the stored head isn't the one this tab saw. */
    | { type: "head-save-refused"; diagramId: string }
    | { type: "load-changed-head-clicked" }
    | { type: "keep-my-edits-clicked" }
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
    | {
        type: "restore-succeeded";
        diagramId: string;
        snapshot: Snapshot;
        stored: StoredHead;
      }
    | { type: "restore-failed" }
    // Preserve
    | { type: "preserve-clicked" }
    | { type: "snapshot-preserved"; created: boolean }
    | {
        type: "preserve-failed";
        reason: "thumbnail-failed" | "empty-diagram" | "request-failed";
      }
    // Leaving the open diagram (another diagram, another page)
    /** A navigation away from the open diagram is waiting on the page. */
    | { type: "leave-requested"; destination: LeaveDestination }
    | { type: "canvas-kept"; diagramId: string }
    | {
        type: "keep-canvas-failed";
        diagramId: string;
        reason: "empty-canvas" | "request-failed";
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
    | { type: "recording-status-reported"; recording: boolean }
    // The status line
    /** Something on the page failed; `message` is what the author reads. */
    | { type: "error-reported"; message: string }
    /** Something the author asked for worked. Nothing is shown for it. */
    | { type: "operation-succeeded" }
    | { type: "error-timed-out"; id: number };

  export type Effect =
    /**
     * Fetch `diagramId`'s head. With `saveOpenHeadFirst`, the head currently
     * open is saved before the canvas stops saving — leaving a diagram keeps
     * its edits; reloading the same one discards them.
     */
    | { type: "load-head"; diagramId: string; saveOpenHeadFirst: boolean }
    /**
     * Put `scene` on the canvas as `diagramId`'s stored head; edits now save,
     * and only over `stored`.
     */
    | {
        type: "show-head";
        diagramId: string;
        scene: TLStoreSnapshot | null;
        stored: StoredHead;
        centreCamera: boolean;
      }
    /** Save the canvas over whatever head is stored now, seen or not. */
    | { type: "overwrite-stored-head"; diagramId: string }
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
    /**
     * Store the canvas as it stands — not the stored head — as one of
     * `diagramId`'s preserved snapshots.
     */
    | { type: "keep-canvas-as-snapshot"; diagramId: string }
    /** Send the held navigation on its way. */
    | { type: "continue-leaving"; destination: LeaveDestination }
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
    /** Report `error-timed-out` for error `id` once `ms` have passed. */
    | { type: "time-out-error"; id: number; ms: number }
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
  leaving: null,
  creating: false,
  videoEditorConnected: false,
  windowFocused: opts.windowFocused,
  isFocusMode: false,
  recording: false,
  timelineVersion: 0,
  error: null,
  errorCount: 0,
});

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

const PRESERVE_ERRORS = {
  "thumbnail-failed": "Failed to render thumbnail",
  "empty-diagram": "Cannot preserve an empty diagram",
  "request-failed": "Failed to preserve snapshot",
} as const;

const SAVE_FAILED = "Couldn't save your edits. The next change retries.";
const KEEP_CANVAS_FAILED =
  "Couldn't keep your edits as a snapshot, so this diagram stays open. Reload or keep your edits first.";
const KEPT_EDITS_REFUSED =
  "Your edits weren't saved: this diagram changed elsewhere again.";

export const diagramPlaygroundReducer: EffectReducer<State, Action, Effect> = (
  state,
  action,
  exec
): State => {
  /** Put `message` in the status line, and take it down after a while. */
  const fail = (
    from: State,
    message: string,
    opts: { fromAutosave?: boolean } = {}
  ): State => {
    const id = from.errorCount + 1;
    exec({ type: "time-out-error", id, ms: STATUS_ERROR_MS });
    return {
      ...from,
      error: { message, id, fromAutosave: opts.fromAutosave ?? false },
      errorCount: id,
    };
  };
  /** Something the author asked for worked: whatever failed before is moot. */
  const succeed = (from: State): State =>
    from.error ? { ...from, error: null } : from;

  const startLoad = (
    from: State,
    diagramId: string,
    opts: { keepCamera?: boolean } = {}
  ): State => {
    const openId = from.head?.diagramId;
    exec({
      type: "load-head",
      diagramId,
      saveOpenHeadFirst: openId !== undefined && openId !== diagramId,
    });
    return {
      ...from,
      head: {
        diagramId,
        status: "loading",
        seen: null,
        saving: false,
        changedElsewhere: false,
        keepCamera: opts.keepCamera ?? false,
        keptMyEdits: false,
        keptAsSnapshot: false,
      },
      timelineVersion: from.timelineVersion + 1,
    };
  };

  /** A result for a diagram the canvas has since moved away from. */
  const isStale = (diagramId: string) => state.head?.diagramId !== diagramId;

  /** The head now on the canvas is `stored`, as loaded or restored. */
  const showHead = (
    diagramId: string,
    scene: TLStoreSnapshot | null,
    stored: StoredHead,
    centreCamera: boolean
  ): State => {
    exec({ type: "show-head", diagramId, scene, stored, centreCamera });
    return {
      ...state,
      head: {
        diagramId,
        status: "ready",
        seen: stored,
        saving: false,
        changedElsewhere: false,
        keepCamera: false,
        keptMyEdits: false,
        keptAsSnapshot: false,
      },
    };
  };

  /** Patch the canvas head, if `diagramId` is still the one on it. */
  const updateHead = (diagramId: string, patch: Partial<CanvasHead>): State =>
    !state.head || isStale(diagramId)
      ? state
      : { ...state, head: { ...state.head, ...patch } };

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
      if (!state.head || isStale(action.diagramId)) return state;
      return showHead(
        action.diagramId,
        action.scene,
        action.stored,
        !state.head.keepCamera
      );
    case "head-load-failed":
      if (isStale(action.diagramId)) return state;
      exec({ type: "clear-canvas" });
      return updateHead(action.diagramId, { status: "failed" });

    case "stored-head-reported": {
      const head = state.head;
      if (!head || isStale(action.diagramId)) return state;
      // Until the head loads, and while a save of ours is on its way, the
      // report can't be told apart from our own write.
      if (head.status !== "ready" || !head.seen || head.saving) return state;
      const { stored } = action;
      if (stored.hash === head.seen.hash) return state;
      // Fetched before our last save landed: old news.
      if (Date.parse(stored.updatedAt) <= Date.parse(head.seen.updatedAt)) {
        return state;
      }
      if (action.canvasHasUnsavedEdits) {
        return head.changedElsewhere
          ? state
          : updateHead(head.diagramId, {
              changedElsewhere: true,
              keptAsSnapshot: false,
            });
      }
      // Nothing of ours to lose: take the new head in place.
      return startLoad(state, head.diagramId, { keepCamera: true });
    }
    case "head-save-started":
      return updateHead(action.diagramId, { saving: true });
    case "head-saved": {
      const saved = updateHead(action.diagramId, {
        saving: false,
        seen: action.stored,
        changedElsewhere: false,
      });
      return saved.error?.fromAutosave ? succeed(saved) : saved;
    }
    case "head-save-failed": {
      if (isStale(action.diagramId)) return state;
      const failed = updateHead(action.diagramId, { saving: false });
      return fail(failed, SAVE_FAILED, { fromAutosave: true });
    }
    case "head-save-refused": {
      if (!state.head || isStale(action.diagramId)) return state;
      const { keptMyEdits } = state.head;
      const refused = updateHead(action.diagramId, {
        saving: false,
        changedElsewhere: true,
        keptMyEdits: false,
        // A refused save is a newer edit than any snapshot kept of the canvas.
        keptAsSnapshot: false,
      });
      // Otherwise the "changed elsewhere" prompt is the whole story.
      return keptMyEdits
        ? fail(refused, KEPT_EDITS_REFUSED, { fromAutosave: true })
        : refused;
    }
    case "load-changed-head-clicked":
      if (!state.head?.changedElsewhere) return state;
      // The author chose the stored head: their unsaved edits go.
      return startLoad(state, state.head.diagramId, { keepCamera: true });
    case "keep-my-edits-clicked":
      if (!state.head?.changedElsewhere) return state;
      exec({ type: "overwrite-stored-head", diagramId: state.head.diagramId });
      return updateHead(state.head.diagramId, {
        changedElsewhere: false,
        keptMyEdits: true,
      });

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
    case "restore-succeeded": {
      if (isStale(action.diagramId)) return state;
      // The server has already moved the head to this snapshot.
      const shown = showHead(
        action.diagramId,
        action.snapshot.scene as TLStoreSnapshot,
        action.stored,
        true
      );
      return { ...succeed(shown), timelineVersion: state.timelineVersion + 1 };
    }
    case "restore-failed":
      return fail(state, "Failed to restore snapshot");

    case "preserve-clicked":
      if (state.preserving || !state.head) return state;
      exec({ type: "preserve-snapshot", diagramId: state.head.diagramId });
      return { ...state, preserving: true };
    case "snapshot-preserved":
      return {
        ...succeed(state),
        preserving: false,
        timelineVersion: state.timelineVersion + (action.created ? 1 : 0),
      };
    case "preserve-failed":
      return fail(
        { ...state, preserving: false },
        PRESERVE_ERRORS[action.reason]
      );

    case "leave-requested":
      if (state.leaving) return state;
      if (!state.head || !mustKeepCanvasBeforeLeaving(state)) {
        exec({ type: "continue-leaving", destination: action.destination });
        return state;
      }
      exec({
        type: "keep-canvas-as-snapshot",
        diagramId: state.head.diagramId,
      });
      return { ...state, leaving: action.destination };
    case "canvas-kept": {
      const destination = state.leaving;
      if (!destination || isStale(action.diagramId)) return state;
      exec({ type: "continue-leaving", destination });
      const kept = updateHead(action.diagramId, { keptAsSnapshot: true });
      return {
        ...kept,
        leaving: null,
        timelineVersion: state.timelineVersion + 1,
      };
    }
    case "keep-canvas-failed": {
      const destination = state.leaving;
      if (!destination || isStale(action.diagramId)) return state;
      // A blank canvas has no drawing to lose.
      if (action.reason === "empty-canvas") {
        exec({ type: "continue-leaving", destination });
        return {
          ...updateHead(action.diagramId, { keptAsSnapshot: true }),
          leaving: null,
        };
      }
      return fail({ ...state, leaving: null }, KEEP_CANVAS_FAILED);
    }

    case "create-clicked":
      if (state.creating) return state;
      exec({ type: "create-diagram" });
      return { ...state, creating: true };
    case "diagram-created":
      exec({ type: "go-to-diagram", diagramId: action.diagramId });
      return { ...succeed(state), creating: false };
    case "create-failed":
      return fail({ ...state, creating: false }, "Failed to create diagram");

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

    case "error-reported":
      return fail(state, action.message);
    case "operation-succeeded":
      return succeed(state);
    case "error-timed-out":
      return state.error?.id === action.id ? { ...state, error: null } : state;
  }
};
