import {
  purgedFiles,
  trashDoneFiles,
  type StorageBucket,
  type StorageDeleteResult,
  type StorageMoveKind,
  type StorageMovePlan,
  type StorageOriginalsResult,
  type StoragePurgeResult,
  type StorageTrashResult,
} from "@/packages/storage/client";

/**
 * A STORAGE ACTION (#2157): every move and delete the Storage pages start,
 * from a row's action menu or a file's. Pure, no React; shared by both
 * pages' reducers. See docs/FRONTEND_STATE.md.
 *
 * Click → `plan-storage-action` (the server's dry run: what would be moved
 * or deleted, and every reason not to) → confirming → confirm →
 * `start-storage-action` (the server checks every refusal again and queues
 * the Sidecar Job) → started: the Job's progress, Cancel and result are
 * drawn on the page from the Job's own events. One at a time per page.
 * A late answer for an action the page has left is ignored (`requestId`).
 */
export namespace storageAction {
  /** A file the per-bucket page listed: where, and its path there. */
  export type FileAt = { readonly location: string; readonly path: string };

  export type Request =
    | {
        type: "move";
        bucket: StorageBucket;
        kind: StorageMoveKind;
        target: string;
        /** Per-file (root-relative); null for the bucket's whole kind. */
        paths: readonly string[] | null;
      }
    | {
        type: "purge";
        bucket: StorageBucket;
        exportPaths: readonly string[] | null;
      }
    | {
        type: "delete-bucket";
        bucket: StorageBucket;
        files: readonly FileAt[] | null;
      }
    | {
        type: "originals";
        bucket: StorageBucket;
        from: string;
        paths: readonly string[] | null;
      }
    | { type: "trash-unused"; files: readonly FileAt[] | null }
    | {
        type: "restore-trash";
        files: readonly (FileAt & { readonly batch: string })[];
      }
    | { type: "empty-trash" };

  export type Plan =
    | { type: "move"; plan: StorageMovePlan }
    | { type: "purge"; result: StoragePurgeResult }
    | { type: "delete-bucket"; result: StorageDeleteResult }
    | { type: "originals"; result: StorageOriginalsResult }
    | { type: "trash"; result: StorageTrashResult };

  export type State =
    | { status: "planning"; request: Request; requestId: number }
    | {
        status: "confirming";
        request: Request;
        requestId: number;
        plan: Plan;
      }
    | { status: "starting"; request: Request; requestId: number; plan: Plan }
    | { status: "failed"; request: Request; message: string };

  export type Action =
    | { type: "storage-action-planned"; requestId: number; plan: Plan }
    | { type: "storage-action-confirmed" }
    | { type: "storage-action-cancelled" }
    | { type: "storage-action-started"; requestId: number; jobId: string }
    | { type: "storage-action-failed"; requestId: number; message: string }
    | { type: "storage-action-dismissed" };

  export type Effect =
    | { type: "plan-storage-action"; requestId: number; request: Request }
    | { type: "start-storage-action"; requestId: number; request: Request };
}

type State = storageAction.State;

export const STORAGE_ACTION_ACTION_TYPES = [
  "storage-action-planned",
  "storage-action-confirmed",
  "storage-action-cancelled",
  "storage-action-started",
  "storage-action-failed",
  "storage-action-dismissed",
] as const satisfies readonly storageAction.Action["type"][];

export const isStorageActionAction = (action: {
  type: string;
}): action is storageAction.Action =>
  (STORAGE_ACTION_ACTION_TYPES as readonly string[]).includes(action.type);

type Exec = (effect: storageAction.Effect) => unknown;

/** Whether an action is being asked for (up to its Job being queued). */
export const storageActionIsBusy = (state: State | null): boolean =>
  state?.status === "planning" ||
  state?.status === "confirming" ||
  state?.status === "starting";

/**
 * Why a plan can't be confirmed (nothing to do, or a refusal), or null.
 * The dialog shows it; confirming is refused with it.
 */
export const planBlockers = (plan: storageAction.Plan): string[] => {
  switch (plan.type) {
    case "move":
      return plan.plan.refusals.map((r) => r.message);
    case "purge":
      return purgedFiles(plan.result) === 0
        ? ["None of these Exported Videos can be deleted now"]
        : [];
    case "delete-bucket":
      return plan.result.deleted.length === 0
        ? ["There is nothing to delete"]
        : [];
    case "originals":
      return plan.result.deleted.files === 0
        ? ["No file here has an identical copy on another drive"]
        : [];
    case "trash":
      return trashDoneFiles(plan.result) === 0 ? ["No file qualifies"] : [];
  }
};

/**
 * Ask the server what `request` would do. Null (refused) while another
 * action is being asked for. `requestId` is the page's next id.
 */
export const beginStorageAction = (
  state: State | null,
  request: storageAction.Request,
  requestId: number,
  exec: Exec
): State | null => {
  if (storageActionIsBusy(state)) return null;
  exec({ type: "plan-storage-action", requestId, request });
  return { status: "planning", request, requestId };
};

/**
 * The action's own events. `startedJobId` is the Job just queued: the page
 * follows it from its Job Events, and the action is done (null).
 */
export const storageActionTransition = (
  state: State | null,
  action: storageAction.Action,
  exec: Exec
): { state: State | null; startedJobId: string | null } => {
  const same = { state, startedJobId: null };
  switch (action.type) {
    case "storage-action-planned":
      if (state?.status !== "planning" || state.requestId !== action.requestId)
        return same;
      return {
        state: { ...state, status: "confirming", plan: action.plan },
        startedJobId: null,
      };
    case "storage-action-confirmed":
      if (state?.status !== "confirming" || planBlockers(state.plan).length > 0)
        return same;
      exec({
        type: "start-storage-action",
        requestId: state.requestId,
        request: state.request,
      });
      return { state: { ...state, status: "starting" }, startedJobId: null };
    case "storage-action-cancelled":
      // Not once it is being started: that answer is still to come.
      if (state?.status !== "planning" && state?.status !== "confirming")
        return same;
      return { state: null, startedJobId: null };
    case "storage-action-started":
      if (state?.status !== "starting" || state.requestId !== action.requestId)
        return same;
      return { state: null, startedJobId: action.jobId };
    case "storage-action-failed":
      if (
        (state?.status !== "planning" && state?.status !== "starting") ||
        state.requestId !== action.requestId
      )
        return same;
      return {
        state: {
          status: "failed",
          request: state.request,
          message: action.message,
        },
        startedJobId: null,
      };
    case "storage-action-dismissed":
      if (state?.status !== "failed") return same;
      return { state: null, startedJobId: null };
  }
};

/** What the action is, in a few words: "Move Crash Course Footage to E:". */
export const storageActionLabel = (
  request: storageAction.Request,
  labelOf: (location: string) => string
): string => {
  const one = (paths: readonly string[] | null, all: string) =>
    paths === null
      ? all
      : paths.length === 1
        ? paths[0]!.split("/").pop()!
        : `${paths.length} files`;
  switch (request.type) {
    case "move":
      return `Move ${one(request.paths, `${request.bucket.name} ${request.kind === "footage" ? "Footage" : request.kind === "exported-videos" ? "Exported Videos" : "Clip Mockups"}`)} to ${labelOf(request.target)}`;
    case "purge":
      return `Delete ${one(request.exportPaths, `${request.bucket.name}'s Exported Videos`)}`;
    case "delete-bucket":
      return `Delete ${one(
        request.files?.map((f) => f.path) ?? null,
        request.bucket.name
      )}`;
    case "originals":
      return `Delete ${one(request.paths, `${request.bucket.name} originals`)} on ${labelOf(request.from)}`;
    case "trash-unused":
      return `Move ${one(request.files?.map((f) => f.path) ?? null, "all Unused Footage")} to the Trash`;
    case "restore-trash":
      return `Restore ${one(
        request.files.map((f) => f.path),
        ""
      )} from the Trash`;
    case "empty-trash":
      return "Empty the Trash";
  }
};
