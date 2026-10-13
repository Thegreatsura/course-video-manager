import type {
  StorageBucket,
  StoragePurgeResult,
} from "@/packages/storage/client";
import { purgedFiles } from "@/packages/storage/client";

/**
 * PURGING EXPORTED VIDEOS (#2111), the half of the Storage page and the
 * per-bucket page that deletes a bucket's Exported Videos. Shared by both
 * pages' reducers; pure, no React. See docs/FRONTEND_STATE.md.
 *
 * Click → `plan-purge` (the server's dry run: the GB it frees and the Videos
 * it skips, because their Footage isn't found) → confirming → confirm →
 * `purge-exports` → purged, and the page counts again. One at a time.
 */
export namespace exportPurge {
  /** The ticked Exported Videos (root-relative), or null for the bucket. */
  export type Selection = readonly string[] | null;

  export type State =
    | {
        status: "planning";
        bucket: StorageBucket;
        exportPaths: Selection;
      }
    | {
        status: "confirming";
        bucket: StorageBucket;
        exportPaths: Selection;
        plan: StoragePurgeResult;
      }
    | {
        status: "purging";
        bucket: StorageBucket;
        exportPaths: Selection;
        plan: StoragePurgeResult;
      }
    | { status: "purged"; bucket: StorageBucket; result: StoragePurgeResult }
    | { status: "failed"; bucket: StorageBucket; message: string };

  export type Action =
    | { type: "purge-planned"; result: StoragePurgeResult }
    | { type: "purge-confirmed" }
    | { type: "purge-cancelled" }
    | { type: "exports-purged"; result: StoragePurgeResult }
    | { type: "purge-failed"; bucketId: string; message: string }
    | { type: "purge-dismissed" };

  export type Effect =
    | { type: "plan-purge"; bucketId: string; exportPaths: Selection }
    | { type: "purge-exports"; bucketId: string; exportPaths: Selection };
}

export const EXPORT_PURGE_ACTION_TYPES = [
  "purge-planned",
  "purge-confirmed",
  "purge-cancelled",
  "exports-purged",
  "purge-failed",
  "purge-dismissed",
] as const satisfies readonly exportPurge.Action["type"][];

export const isExportPurgeAction = (action: {
  type: string;
}): action is exportPurge.Action =>
  (EXPORT_PURGE_ACTION_TYPES as readonly string[]).includes(action.type);

/** The reducer's `exec`, narrowed to the Purge's effects. */
type Exec = (effect: exportPurge.Effect) => unknown;

/** Whether a Purge is under way (asked, confirming or deleting). */
export const purgeIsBusy = (purge: exportPurge.State | null) =>
  purge?.status === "planning" ||
  purge?.status === "confirming" ||
  purge?.status === "purging";

/**
 * Start a Purge of `bucket` (the ticked `exportPaths`, or all of it): ask the
 * server what it would delete. Null when one is already under way.
 */
export const startPurge = (
  purge: exportPurge.State | null,
  bucket: StorageBucket,
  exportPaths: exportPurge.Selection,
  exec: Exec
): exportPurge.State | null => {
  if (purgeIsBusy(purge)) return null;
  exec({ type: "plan-purge", bucketId: bucket.id, exportPaths });
  return { status: "planning", bucket, exportPaths };
};

/**
 * The Purge's own events. `purged` is true when the files have just gone:
 * the page then counts again from nothing.
 */
export const purgeTransition = (
  purge: exportPurge.State | null,
  action: exportPurge.Action,
  exec: Exec
): { purge: exportPurge.State | null; purged: boolean } => {
  const same = { purge, purged: false };
  switch (action.type) {
    case "purge-planned":
      if (
        purge?.status !== "planning" ||
        purge.bucket.id !== action.result.bucketId
      )
        return same;
      return {
        purge: { ...purge, status: "confirming", plan: action.result },
        purged: false,
      };
    case "purge-confirmed":
      // Nothing to delete (every Video skipped): nothing to confirm.
      if (purge?.status !== "confirming" || purgedFiles(purge.plan) === 0)
        return same;
      exec({
        type: "purge-exports",
        bucketId: purge.bucket.id,
        exportPaths: purge.exportPaths,
      });
      return { purge: { ...purge, status: "purging" }, purged: false };
    case "purge-cancelled":
      // Not once the files are going: that answer is still to come.
      if (purge?.status !== "planning" && purge?.status !== "confirming")
        return same;
      return { purge: null, purged: false };
    case "exports-purged":
      if (
        purge?.status !== "purging" ||
        purge.bucket.id !== action.result.bucketId
      )
        return same;
      return {
        purge: {
          status: "purged",
          bucket: purge.bucket,
          result: action.result,
        },
        purged: true,
      };
    case "purge-failed":
      if (
        (purge?.status !== "planning" && purge?.status !== "purging") ||
        purge.bucket.id !== action.bucketId
      )
        return same;
      return {
        purge: {
          status: "failed",
          bucket: purge.bucket,
          message: action.message,
        },
        purged: false,
      };
    case "purge-dismissed":
      if (purge?.status !== "purged" && purge?.status !== "failed") return same;
      return { purge: null, purged: false };
  }
};
