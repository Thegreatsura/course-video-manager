import type {
  StorageBucket,
  StorageOriginalsResult,
} from "@/packages/storage/client";

/**
 * "DELETE ORIGINALS" (#2110) on the per-bucket page: after a move, delete the
 * bucket's files on one Storage Root that have an identical copy on another.
 * Pure, no React. See docs/FRONTEND_STATE.md.
 *
 * Click "Delete originals on D:" → `plan-delete-originals` (the server's
 * count, deleting nothing) → confirming → confirm → `start-delete-originals`
 * (the server checks every refusal again and enqueues a `storage-delete`
 * Sidecar Job) → started: the Job's row in the Upload Manager shows its
 * progress, a Cancel, and "N files still on D:, retry". Never automatic; one
 * at a time.
 */
export namespace deleteOriginals {
  export type State =
    | { status: "planning"; bucket: StorageBucket; from: string }
    | {
        status: "confirming";
        bucket: StorageBucket;
        from: string;
        plan: StorageOriginalsResult;
      }
    | {
        status: "starting";
        bucket: StorageBucket;
        from: string;
        plan: StorageOriginalsResult;
      }
    | {
        status: "started";
        bucket: StorageBucket;
        from: string;
        plan: StorageOriginalsResult;
        jobId: string;
      }
    | {
        status: "failed";
        bucket: StorageBucket;
        from: string;
        message: string;
      };

  export type Action =
    | { type: "originals-planned"; result: StorageOriginalsResult }
    | { type: "delete-originals-confirmed" }
    | { type: "delete-originals-cancelled" }
    | { type: "delete-originals-started"; jobId: string }
    | {
        type: "delete-originals-failed";
        bucketId: string;
        from: string;
        message: string;
      }
    | { type: "delete-originals-dismissed" };

  export type Effect =
    | { type: "plan-delete-originals"; bucketId: string; from: string }
    | { type: "start-delete-originals"; bucketId: string; from: string };
}

export const DELETE_ORIGINALS_ACTION_TYPES = [
  "originals-planned",
  "delete-originals-confirmed",
  "delete-originals-cancelled",
  "delete-originals-started",
  "delete-originals-failed",
  "delete-originals-dismissed",
] as const satisfies readonly deleteOriginals.Action["type"][];

export const isDeleteOriginalsAction = (action: {
  type: string;
}): action is deleteOriginals.Action =>
  (DELETE_ORIGINALS_ACTION_TYPES as readonly string[]).includes(action.type);

type Exec = (effect: deleteOriginals.Effect) => unknown;

/** Whether "Delete originals" is being asked for (up to its Job's start). */
export const deleteOriginalsIsBusy = (
  state: deleteOriginals.State | null
): boolean =>
  state?.status === "planning" ||
  state?.status === "confirming" ||
  state?.status === "starting";

/** Ask the server what would go from `from`. Null when one is under way. */
export const startDeleteOriginals = (
  state: deleteOriginals.State | null,
  bucket: StorageBucket,
  from: string,
  exec: Exec
): deleteOriginals.State | null => {
  if (deleteOriginalsIsBusy(state)) return null;
  exec({ type: "plan-delete-originals", bucketId: bucket.id, from });
  return { status: "planning", bucket, from };
};

/**
 * Its own events. `relist` is true when the page should list again from
 * nothing: the Job's banner was dismissed (it has deleted, or is deleting).
 */
export const deleteOriginalsTransition = (
  state: deleteOriginals.State | null,
  action: deleteOriginals.Action,
  exec: Exec
): { state: deleteOriginals.State | null; relist: boolean } => {
  const same = { state, relist: false };
  switch (action.type) {
    case "originals-planned":
      if (
        state?.status !== "planning" ||
        state.bucket.id !== action.result.bucketId ||
        state.from !== action.result.from
      )
        return same;
      return {
        state: { ...state, status: "confirming", plan: action.result },
        relist: false,
      };
    case "delete-originals-confirmed":
      // Nothing to delete: nothing to confirm.
      if (state?.status !== "confirming" || state.plan.deleted.files === 0)
        return same;
      exec({
        type: "start-delete-originals",
        bucketId: state.bucket.id,
        from: state.from,
      });
      return { state: { ...state, status: "starting" }, relist: false };
    case "delete-originals-cancelled":
      // Not once it is being started: that answer is still to come.
      if (state?.status !== "planning" && state?.status !== "confirming")
        return same;
      return { state: null, relist: false };
    case "delete-originals-started":
      if (state?.status !== "starting") return same;
      return {
        state: { ...state, status: "started", jobId: action.jobId },
        relist: false,
      };
    case "delete-originals-failed":
      if (
        (state?.status !== "planning" && state?.status !== "starting") ||
        state.bucket.id !== action.bucketId ||
        state.from !== action.from
      )
        return same;
      return {
        state: {
          status: "failed",
          bucket: state.bucket,
          from: state.from,
          message: action.message,
        },
        relist: false,
      };
    case "delete-originals-dismissed":
      if (state?.status !== "started" && state?.status !== "failed")
        return same;
      return { state: null, relist: state.status === "started" };
  }
};
