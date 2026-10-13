import type { StorageOriginalsResult } from "@/packages/storage/client";
import type { deleteOriginals } from "./delete-originals";

/** The server's refusal arrives as a JSON string, or as plain text. */
const refusalText = (body: string) => {
  try {
    const parsed: unknown = JSON.parse(body);
    return typeof parsed === "string" ? parsed : body;
  } catch {
    return body;
  }
};

const failed = (
  effect: deleteOriginals.Effect,
  error: unknown
): deleteOriginals.Action => ({
  type: "delete-originals-failed",
  bucketId: effect.bucketId,
  from: effect.from,
  message: error instanceof Error ? error.message : String(error),
});

/**
 * The `plan-delete-originals` effect: the server's count, for the
 * confirmation. Deletes nothing.
 */
export const planDeleteOriginals = (
  effect: Extract<deleteOriginals.Effect, { type: "plan-delete-originals" }>,
  dispatch: (action: deleteOriginals.Action) => void
) => {
  fetch(
    `/api/storage/buckets/${encodeURIComponent(effect.bucketId)}/originals-plan?from=${encodeURIComponent(effect.from)}`
  )
    .then(async (response) => {
      if (!response.ok) throw new Error(refusalText(await response.text()));
      dispatch({
        type: "originals-planned",
        result: (await response.json()) as StorageOriginalsResult,
      });
    })
    .catch((error: unknown) => dispatch(failed(effect, error)));
};

/** The `start-delete-originals` effect: enqueues the `storage-delete` Job. */
export const startDeleteOriginalsJob = (
  effect: Extract<deleteOriginals.Effect, { type: "start-delete-originals" }>,
  dispatch: (action: deleteOriginals.Action) => void
) => {
  fetch(
    `/api/storage/buckets/${encodeURIComponent(effect.bucketId)}/delete-originals`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from: effect.from }),
    }
  )
    .then(async (response) => {
      if (!response.ok) throw new Error(refusalText(await response.text()));
      const { jobId } = (await response.json()) as { jobId: string };
      dispatch({ type: "delete-originals-started", jobId });
    })
    .catch((error: unknown) => dispatch(failed(effect, error)));
};
