import type { StoragePurgeResult } from "@/packages/storage/client";
import type { exportPurge } from "./export-purge";

/** The server's refusal arrives as a JSON string, or as plain text. */
const refusalText = (body: string) => {
  try {
    const parsed: unknown = JSON.parse(body);
    return typeof parsed === "string" ? parsed : body;
  } catch {
    return body;
  }
};

const postPurge = (
  bucketId: string,
  exportPaths: exportPurge.Selection,
  dryRun: boolean,
  onResult: (result: StoragePurgeResult) => exportPurge.Action,
  dispatch: (action: exportPurge.Action) => void
) => {
  fetch(`/api/storage/buckets/${encodeURIComponent(bucketId)}/purge-exports`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      dryRun,
      ...(exportPaths === null ? {} : { exportPaths }),
    }),
  })
    .then(async (response) => {
      if (!response.ok) throw new Error(refusalText(await response.text()));
      dispatch(onResult((await response.json()) as StoragePurgeResult));
    })
    .catch((error: unknown) =>
      dispatch({
        type: "purge-failed",
        bucketId,
        message: error instanceof Error ? error.message : String(error),
      })
    );
};

/**
 * The `plan-purge` effect: asks the server what a Purge would delete (a dry
 * run), for the confirmation.
 */
export const planPurge = (
  effect: Extract<exportPurge.Effect, { type: "plan-purge" }>,
  dispatch: (action: exportPurge.Action) => void
) =>
  postPurge(
    effect.bucketId,
    effect.exportPaths,
    true,
    (result) => ({ type: "purge-planned", result }),
    dispatch
  );

/** The `purge-exports` effect: deletes, and reports what went. */
export const purgeExports = (
  effect: Extract<exportPurge.Effect, { type: "purge-exports" }>,
  dispatch: (action: exportPurge.Action) => void
) =>
  postPurge(
    effect.bucketId,
    effect.exportPaths,
    false,
    (result) => ({ type: "exports-purged", result }),
    dispatch
  );
