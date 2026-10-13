import type { EffectEntity, EffectReducer } from "use-effect-reducer";
import {
  isExportPurgeAction,
  purgeIsBusy,
  purgeTransition,
  startPurge,
  type exportPurge,
} from "./export-purge";
import {
  deleteOriginalsIsBusy,
  deleteOriginalsTransition,
  isDeleteOriginalsAction,
  startDeleteOriginals,
  type deleteOriginals,
} from "./delete-originals";
import {
  addFoundFiles,
  bucketCanBePurged,
  dropFilesAt,
  largestFirst,
  movableKindsOf,
  originalsAt,
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
 * and the server stops the walk. Nothing is cached. Exported Videos can be
 * ticked and Purged (#2111); everything else is listed only. After a move,
 * "Delete originals on D:" deletes the files on D: that have an identical
 * copy on another root (#2110). See docs/FRONTEND_STATE.md.
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
    /** The ticked Exported Videos (root-relative paths), in tick order. */
    selected: string[];
    /** Purging the ticked Exported Videos: asked, under way, or done. */
    purge: exportPurge.State | null;
    /** "Delete originals" (#2110): asked, under way, or done. */
    originals: deleteOriginals.State | null;
  };

  export type Action =
    | StorageBucketFilesMessage
    | { type: "page-opened" }
    | { type: "listing-failed"; message: string }
    | { type: "export-checkbox-toggled"; path: string }
    | { type: "purge-selected-clicked" }
    | { type: "delete-originals-clicked"; from: string }
    | exportPurge.Action
    | deleteOriginals.Action;

  export type Effect =
    | { type: "listen-to-listing"; bucketId: string }
    | exportPurge.Effect
    | deleteOriginals.Effect;
}

type State = bucketPageReducer.State;
type Action = bucketPageReducer.Action;
type Effect = bucketPageReducer.Effect;

/**
 * The page starts listening on `page-opened`, not here: a listener started
 * from the initial state is stopped by React Strict Mode's mount → unmount →
 * mount (client-side navigation in dev) and never started again.
 */
export const createInitialBucketPageState = (bucketId: string): State => ({
  bucketId,
  status: "listing",
  failure: null,
  roots: null,
  bucket: null,
  files: {},
  unreadableRoots: {},
  listing: null,
  selected: [],
  purge: null,
  originals: null,
});

/** List again from nothing: what a Purge deleted is gone from the list. */
const relist = (
  state: State,
  exec: Parameters<EffectReducer<State, Action, Effect>>[2]
): State => {
  if (state.listing) exec.stop(state.listing);
  return {
    ...createInitialBucketPageState(state.bucketId),
    purge: state.purge,
    originals: state.originals,
    listing: exec({ type: "listen-to-listing", bucketId: state.bucketId }),
  };
};

/** Whether the file can be ticked: an Exported Video of a purgeable bucket. */
export const fileCanBeTicked = (state: State, path: string): boolean =>
  state.bucket !== null &&
  bucketCanBePurged(state.bucket) &&
  state.files[path]?.role === "exported-video";

/** Ticking Exported Videos and Purging them (#2111). */
const selectionReducer = (
  state: State,
  action: Action,
  exec: Parameters<EffectReducer<State, Action, Effect>>[2]
): State | null => {
  if (action.type === "export-checkbox-toggled") {
    if (purgeIsBusy(state.purge) || deleteOriginalsIsBusy(state.originals))
      return state;
    if (state.selected.includes(action.path)) {
      return {
        ...state,
        selected: state.selected.filter((p) => p !== action.path),
      };
    }
    if (!fileCanBeTicked(state, action.path)) return state;
    return { ...state, selected: [...state.selected, action.path] };
  }
  if (action.type === "purge-selected-clicked") {
    if (state.status !== "complete" || state.bucket === null) return state;
    if (state.selected.length === 0 || !bucketCanBePurged(state.bucket))
      return state;
    if (deleteOriginalsIsBusy(state.originals)) return state;
    const purge = startPurge(
      state.purge,
      state.bucket,
      [...state.selected],
      exec
    );
    return purge === null ? state : { ...state, purge };
  }
  if (!isExportPurgeAction(action)) return null;
  const next = purgeTransition(state.purge, action, exec);
  if (next.purge === state.purge) return state;
  const after = { ...state, purge: next.purge };
  return next.purged ? relist(after, exec) : after;
};

/** "Delete originals on <root>" (#2110): only from what the listing offers. */
const originalsReducer = (
  state: State,
  action: Action,
  exec: Parameters<EffectReducer<State, Action, Effect>>[2]
): State | null => {
  if (action.type === "delete-originals-clicked") {
    if (state.bucket === null || purgeIsBusy(state.purge)) return state;
    const offered = originalsOffers(state).some(
      (o) => o.location === action.from
    );
    if (!offered) return state;
    const originals = startDeleteOriginals(
      state.originals,
      state.bucket,
      action.from,
      exec
    );
    return originals === null ? state : { ...state, originals };
  }
  if (!isDeleteOriginalsAction(action)) return null;
  const next = deleteOriginalsTransition(state.originals, action, exec);
  if (next.state === state.originals) return state;
  const after = { ...state, originals: next.state };
  return next.relist ? relist(after, exec) : after;
};

export const bucketPageReducer: EffectReducer<State, Action, Effect> = (
  state,
  action,
  exec
) => {
  const afterSelection = selectionReducer(state, action, exec);
  if (afterSelection !== null) return afterSelection;
  const afterOriginals = originalsReducer(state, action, exec);
  if (afterOriginals !== null) return afterOriginals;
  // A message after the listing has settled (a late event, or the browser
  // reporting the closed stream) changes nothing.
  if (state.status !== "listing") return state;
  switch (action.type) {
    case "page-opened":
      // Opened again (Strict Mode remounts): one listener, the newest.
      if (state.listing) exec.stop(state.listing);
      return {
        ...state,
        listing: exec({ type: "listen-to-listing", bucketId: state.bucketId }),
      };
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
    case "export-checkbox-toggled":
    case "purge-selected-clicked":
    case "purge-planned":
    case "purge-confirmed":
    case "purge-cancelled":
    case "exports-purged":
    case "purge-failed":
    case "purge-dismissed":
    case "delete-originals-clicked":
    case "originals-planned":
    case "delete-originals-confirmed":
    case "delete-originals-cancelled":
    case "delete-originals-started":
    case "delete-originals-failed":
    case "delete-originals-dismissed":
      // Ticking, the Purge and "Delete originals", handled above.
      return state;
  }
};

// --- selectors ---------------------------------------------------------------

/** The ticked Exported Videos' bytes (the largest copy of each). */
export const selectedBytes = (state: State): number =>
  state.selected.reduce((n, p) => n + (state.files[p]?.bytes ?? 0), 0);

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

/**
 * Each Storage Root "Delete originals" can be offered on, with the files on
 * it that have a same-size copy on another root and their bytes: once the
 * listing is complete, for a bucket whose files are moved, and only an
 * online root. The server checks every one again, by checksum.
 */
export const originalsOffers = (
  state: State
): { location: string; files: number; bytes: number }[] => {
  if (state.status !== "complete" || state.bucket === null) return [];
  if (movableKindsOf(state.bucket).length === 0) return [];
  return (state.roots ?? [])
    .filter((r) => r.online && !(r.root in state.unreadableRoots))
    .map((r) => ({ location: r.root, ...originalsAt(state.files, r.root) }))
    .filter((o) => o.files > 0);
};
