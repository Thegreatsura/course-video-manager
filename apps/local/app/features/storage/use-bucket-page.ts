import { useEffect } from "react";
import { useEffectReducer } from "@/hooks/use-effect-reducer";
import {
  planStorageAction,
  startStorageAction,
} from "./storage-action-effects";
import { loadTrash } from "./trash-effects";
import {
  STORAGE_BUCKET_FILES_MESSAGE_TYPES,
  type StorageBucketFilesMessage,
} from "@/packages/storage/client";
import {
  bucketPageReducer,
  createInitialBucketPageState,
} from "./bucket-page-reducer";

/**
 * The `listen-to-listing` effect: listens to the bucket's listing while the
 * page is open. Closing the stream (leaving the page, or the reducer stopping
 * the effect once the listing is over) is what stops the walk on the server.
 */
const listenToListing = (
  bucketId: string,
  dispatch: (action: bucketPageReducer.Action) => void
) => {
  const source = new EventSource(
    `/api/storage/buckets/${encodeURIComponent(bucketId)}/files`
  );
  for (const type of STORAGE_BUCKET_FILES_MESSAGE_TYPES) {
    source.addEventListener(type, (event) => {
      dispatch(JSON.parse(event.data) as StorageBucketFilesMessage);
    });
  }
  // The server's own failure carries a message; a dropped connection does not.
  source.addEventListener("error", (event) => {
    const data = (event as MessageEvent).data;
    const message =
      typeof data === "string"
        ? (JSON.parse(data) as { message: string }).message
        : "The connection to the listing was lost";
    dispatch({ type: "listing-failed", message });
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

/**
 * The `reveal-file` effect: Show in Explorer. Only a failure is news.
 */
const revealFile = (
  effect: { location: string; path: string },
  dispatch: (action: bucketPageReducer.Action) => void
) => {
  fetch("/api/storage/reveal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ location: effect.location, path: effect.path }),
  })
    .then(async (response) => {
      if (!response.ok) throw new Error(await response.text());
    })
    .catch((error: unknown) =>
      dispatch({
        type: "reveal-failed",
        message: `Could not show it in Explorer: ${error instanceof Error ? error.message : String(error)}`,
      })
    );
};

/**
 * The effect runner for `bucketPageReducer`, and the bridge that tells it the
 * page has opened. Remount it for another bucket.
 */
export const useBucketPage = (bucketId: string) => {
  const [state, dispatch] = useEffectReducer(
    bucketPageReducer,
    createInitialBucketPageState(bucketId),
    {
      "listen-to-listing": (_state, effect, dispatch) =>
        listenToListing(effect.bucketId, dispatch),
      "load-trash": (_state, _effect, dispatch) => loadTrash(dispatch),
      "reveal-file": (_state, effect, dispatch) => revealFile(effect, dispatch),
      "plan-storage-action": (_state, effect, dispatch) =>
        planStorageAction(effect, dispatch),
      "start-storage-action": (_state, effect, dispatch) =>
        startStorageAction(effect, dispatch),
    }
  );
  useEffect(() => {
    dispatch({ type: "page-opened" });
  }, [dispatch]);
  return [state, dispatch] as const;
};
