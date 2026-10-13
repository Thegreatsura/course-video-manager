import type { EffectEntity, EffectReducer } from "use-effect-reducer";
import {
  addFoundFiles,
  dropFilesAt,
  largestFirst,
  type StorageBucket,
  type StorageBucketFile,
  type StorageBucketFilesMessage,
  type StorageRootReport,
} from "@/packages/storage/client";

/**
 * THE PER-BUCKET PAGE (#2108): one Storage Bucket's files, largest first,
 * each with what it is and the Storage Root(s) it is on. Opening the page
 * listens to the listing (`/api/storage/buckets/:bucketId/files`), which
 * streams files as the walk finds them; leaving the page closes the stream,
 * and the server stops the walk. Read-only, and nothing is cached. See
 * docs/FRONTEND_STATE.md.
 */
export namespace bucketPageReducer {
  export type State = {
    bucketId: string;
    status: "listing" | "complete" | "failed";
    failure: string | null;
    /** Each Storage Root's size and free space; null until measured. */
    roots: StorageRootReport[] | null;
    /** Null until the server names the bucket. */
    bucket: StorageBucket | null;
    /** path → the file, its copies added up from what the walk found. */
    files: Record<string, StorageBucketFile>;
    /** Roots the walk could not read, and why: shown with no files. */
    unreadableRoots: Record<string, string>;
    listing: EffectEntity<State, Action> | null;
  };

  export type Action =
    StorageBucketFilesMessage | { type: "listing-failed"; message: string };

  export type Effect = { type: "listen-to-listing"; bucketId: string };
}

type State = bucketPageReducer.State;
type Action = bucketPageReducer.Action;
type Effect = bucketPageReducer.Effect;

export const createInitialBucketPageState =
  (bucketId: string) =>
  (exec: (effect: Effect) => EffectEntity<State, Action>): State => ({
    bucketId,
    status: "listing",
    failure: null,
    roots: null,
    bucket: null,
    files: {},
    unreadableRoots: {},
    listing: exec({ type: "listen-to-listing", bucketId }),
  });

export const bucketPageReducer: EffectReducer<State, Action, Effect> = (
  state,
  action,
  exec
) => {
  // A message after the listing has settled (a late event, or the browser
  // reporting the closed stream) changes nothing.
  if (state.status !== "listing") return state;
  switch (action.type) {
    case "roots-measured":
      return { ...state, roots: action.roots };
    case "bucket-identified":
      return { ...state, bucket: action.bucket };
    case "files-found":
      return {
        ...state,
        files: addFoundFiles(
          state.files,
          action.files.filter((f) => !(f.location in state.unreadableRoots))
        ),
      };
    case "root-unreadable":
      // A root that could not be read shows no files, not some.
      return {
        ...state,
        files: dropFilesAt(state.files, action.root),
        unreadableRoots: {
          ...state.unreadableRoots,
          [action.root]: action.message,
        },
      };
    case "scan-completed":
      if (state.listing) exec.stop(state.listing);
      return { ...state, status: "complete", listing: null };
    case "listing-failed":
      if (state.listing) exec.stop(state.listing);
      return {
        ...state,
        status: "failed",
        failure: action.message,
        listing: null,
      };
  }
};

// --- selectors ---------------------------------------------------------------

/** The bucket's files, largest first. */
export const bucketFiles = (state: State): StorageBucketFile[] =>
  largestFirst(state.files);

/** Bytes in the bucket on each location, and files found there. */
export const bucketTotals = (
  state: State
): { location: string; bytes: number; files: number }[] => {
  const totals = new Map<string, { bytes: number; files: number }>();
  for (const root of state.roots ?? []) {
    if (root.online) totals.set(root.root, { bytes: 0, files: 0 });
  }
  for (const file of Object.values(state.files)) {
    for (const [location, bytes] of Object.entries(file.copies)) {
      const was = totals.get(location) ?? { bytes: 0, files: 0 };
      totals.set(location, { bytes: was.bytes + bytes, files: was.files + 1 });
    }
  }
  return [...totals].map(([location, t]) => ({ location, ...t }));
};
