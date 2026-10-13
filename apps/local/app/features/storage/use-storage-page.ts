import { useEffect } from "react";
import { useEffectReducer } from "use-effect-reducer";
import { planPurge, purgeExports } from "./export-purge-effects";
import {
  STORAGE_SCAN_MESSAGE_TYPES,
  type StorageDeleteResult,
  type StorageScanMessage,
} from "@/packages/storage/client";
import {
  createInitialStoragePageState,
  storagePageReducer,
} from "./storage-page-reducer";

/**
 * The `listen-to-scan` effect: listens to `GET /api/storage/scan` while the
 * page is open. Closing the stream (leaving the page, or the reducer stopping
 * the effect once the scan is over) is what stops the walk on the server.
 */
const listenToScan = (
  dispatch: (action: storagePageReducer.Action) => void
) => {
  const source = new EventSource("/api/storage/scan");
  for (const type of STORAGE_SCAN_MESSAGE_TYPES) {
    source.addEventListener(type, (event) => {
      dispatch(JSON.parse(event.data) as StorageScanMessage);
    });
  }
  // The server's own failure carries a message; a dropped connection does not.
  source.addEventListener("error", (event) => {
    const data = (event as MessageEvent).data;
    const message =
      typeof data === "string"
        ? (JSON.parse(data) as { message: string }).message
        : "The connection to the scan was lost";
    dispatch({ type: "scan-failed", message });
  });
  // A page kept in the back/forward cache would keep its stream (and the
  // walk) going: close it on the way out.
  const close = () => source.close();
  window.addEventListener("pagehide", close);
  return () => {
    window.removeEventListener("pagehide", close);
    source.close();
  };
};

/** The server's refusal arrives as a JSON string, or as plain text. */
const refusalText = (body: string) => {
  try {
    const parsed: unknown = JSON.parse(body);
    return typeof parsed === "string" ? parsed : body;
  } catch {
    return body;
  }
};

/**
 * The `delete-bucket` effect: asks the server to delete an Other bucket's
 * files, and reports what it did (or why it would not).
 */
const deleteBucket = (
  bucketId: string,
  dispatch: (action: storagePageReducer.Action) => void
) => {
  fetch(`/api/storage/buckets/${encodeURIComponent(bucketId)}/delete`, {
    method: "POST",
  })
    .then(async (response) => {
      if (!response.ok) throw new Error(refusalText(await response.text()));
      dispatch({
        type: "bucket-deleted",
        result: (await response.json()) as StorageDeleteResult,
      });
    })
    .catch((error: unknown) =>
      dispatch({
        type: "bucket-delete-failed",
        bucketId,
        message: error instanceof Error ? error.message : String(error),
      })
    );
};

/**
 * The effect runner for `storagePageReducer`, and the bridge that tells it
 * the page has opened.
 */
export const useStoragePage = () => {
  const [state, dispatch] = useEffectReducer(
    storagePageReducer,
    createInitialStoragePageState(),
    {
      "listen-to-scan": (_state, _effect, dispatch) => listenToScan(dispatch),
      "delete-bucket": (_state, effect, dispatch) =>
        deleteBucket(effect.bucketId, dispatch),
      "plan-purge": (_state, effect, dispatch) => planPurge(effect, dispatch),
      "purge-exports": (_state, effect, dispatch) =>
        purgeExports(effect, dispatch),
    }
  );
  useEffect(() => {
    dispatch({ type: "page-opened" });
  }, [dispatch]);
  return [state, dispatch] as const;
};
