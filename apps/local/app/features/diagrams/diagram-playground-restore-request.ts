import type {
  DiagramPlaygroundEffect,
  LeaveSaveOutcome,
  PendingRestore,
} from "./diagram-playground-reducer.types";
import type { diagramPlaygroundReducer } from "./diagram-playground-reducer";
import {
  RESTORE_BEFORE_LOADED,
  SAVE_BEFORE_RESTORING_FAILED,
} from "./diagram-playground-status-messages";
import { isHeadCaptured } from "./snapshot-list";

type State = diagramPlaygroundReducer.State;
type Action = Extract<
  diagramPlaygroundReducer.Action,
  {
    type:
      "restore-requested" | "snapshot-link-opened" | "linked-snapshot-fetched";
  }
>;
type Exec = (effect: DiagramPlaygroundEffect) => void;
type Fail = (from: State, message: string) => State;

/** Restore `restoring`'s snapshot over the head this tab last saw. */
export function restoreNow(
  state: State,
  diagramId: string,
  restoring: PendingRestore,
  exec: Exec
): void {
  exec({
    type: "restore-snapshot",
    diagramId,
    snapshot: restoring.snapshot,
    expectedHeadHash: state.head?.seen?.hash ?? null,
    requestId: restoring.requestId,
  });
}

/**
 * The canvas's last edit has settled ahead of a restore: restore over a
 * head the timeline holds, or keep the canvas as a snapshot first.
 */
export function savedBeforeRestoring(
  state: State,
  outcome: LeaveSaveOutcome,
  exec: Exec,
  fail: Fail
): State {
  const { restoring, head } = state;
  if (!restoring || !head) return state;
  if (outcome === "failed") {
    exec({ type: "release-restore-request", requestId: restoring.requestId });
    return fail({ ...state, restoring: null }, SAVE_BEFORE_RESTORING_FAILED);
  }
  // Refused: the canvas holds edits the head doesn't, so keep them first.
  const captured =
    outcome === "saved" &&
    isHeadCaptured(restoring.timeline, head.seen?.hash ?? null);
  if (captured) restoreNow(state, head.diagramId, restoring, exec);
  else exec({ type: "keep-canvas-as-snapshot", diagramId: head.diagramId });
  return state;
}

/**
 * Go on to the linked snapshot once its diagram's head is on the canvas. It
 * is looked up on the timeline first, so the restore knows, as a Snapshot
 * Timeline row click does, whether the head it overwrites is held there.
 */
export function followSnapshotLink(state: State, exec: Exec): State {
  const link = state.linkedSnapshot;
  if (!link || state.head?.diagramId !== link.diagramId) return state;
  if (state.head.status !== "ready") return state;
  exec({ type: "fetch-linked-snapshot", ...link });
  return { ...state, linkedSnapshot: null };
}

/**
 * `diagramPlaygroundReducer`'s ways of asking for a Restore to Head: a
 * timeline row, the palette or a Snapshot Step, and a link to one of the
 * open diagram's snapshots (a Clip's, from the Video Editor). All of them
 * go through the one restore flow, so none can lose the head it overwrites.
 */
export function reduceRestoreRequest(
  state: State,
  action: Action,
  exec: Exec,
  fail: Fail
): State {
  if (action.type === "snapshot-link-opened") {
    const { diagramId, snapshotId } = action;
    return followSnapshotLink(
      { ...state, linkedSnapshot: { diagramId, snapshotId } },
      exec
    );
  }
  const { snapshot, timeline, requestId } = action;
  // The linked snapshot's diagram is no longer on the canvas.
  const stale =
    action.type === "linked-snapshot-fetched" &&
    state.head?.diagramId !== action.diagramId;
  // One way off the head at a time.
  if (stale || state.restoring || state.leaving) {
    exec({ type: "release-restore-request", requestId });
    return state;
  }
  if (state.head?.status !== "ready") {
    exec({ type: "release-restore-request", requestId });
    return fail(state, RESTORE_BEFORE_LOADED);
  }
  // Whether the timeline holds the head is only known once the canvas's
  // last edit is stored as the head.
  exec({ type: "save-before-leaving", diagramId: state.head.diagramId });
  return { ...state, restoring: { snapshot, timeline, requestId } };
}
