import { useEffectReducer } from "use-effect-reducer";
import {
  STORAGE_BUCKET_FILES_MESSAGE_TYPES,
  type StorageBucketFilesMessage,
} from "@/packages/storage/buckets";
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

/** The effect runner for `bucketPageReducer`. Remount it for another bucket. */
export const useBucketPage = (bucketId: string) =>
  useEffectReducer(bucketPageReducer, createInitialBucketPageState(bucketId), {
    "listen-to-listing": (_state, effect, dispatch) =>
      listenToListing(effect.bucketId, dispatch),
  });
