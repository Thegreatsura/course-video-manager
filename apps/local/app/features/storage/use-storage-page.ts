import { useEffectReducer } from "use-effect-reducer";
import {
  STORAGE_SCAN_MESSAGE_TYPES,
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

/** The effect runner for `storagePageReducer`. */
export const useStoragePage = () =>
  useEffectReducer(storagePageReducer, createInitialStoragePageState, {
    "listen-to-scan": (_state, _effect, dispatch) => listenToScan(dispatch),
  });
