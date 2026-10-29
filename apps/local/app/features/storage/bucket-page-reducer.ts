import type { EffectEntity, EffectReducer } from "use-effect-reducer";
import {
  beginStorageAction,
  isStorageActionAction,
  storageActionIsBusy,
  storageActionTransition,
  type storageAction,
} from "./storage-action";
import {
  isStale,
  type CachedListing,
  type RemovedBytes,
} from "./storage-cache";
import {
  copiesDeleted,
  deletePlanOf,
  deleteRequest,
  fileActions,
  fileCanBeTicked,
  fileRequest,
  removedBytesOf,
  sameChoice,
  withoutCopies,
} from "./bucket-page-files";

export {
  copiesDeleted,
  fileActions,
  fileCanBeTicked,
  type FileAction,
} from "./bucket-page-files";
import { watchStorageJobs, type ObservedStorageJob } from "./storage-jobs";
import {
  addFoundFiles,
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
 * each with the drive(s) it is on and what it is. The listing
 * (`/api/storage/buckets/:bucketId/files`) streams files as the walk finds
 * them; leaving the page closes the stream, and the server stops the walk.
 * See docs/FRONTEND_STATE.md.
 *
 * What a listing found is kept in the Storage cache (#2423,
 * `storage-cache.ts`): opening the page shows it when it is under five
 * minutes old, and lists again when it is older. The page never lists again
 * on its own while it is being looked at; a refocus lists only stale data,
 * and Refresh lists at once.
 *
 * Each file has an action menu (#2157) with what its bucket allows: Delete
 * (an Exported Video whose Footage is found, an Other bucket's file, or
 * Unused Footage, deleted for good), Move to another drive, Delete original
 * (only where an identical copy is on another drive), and Show in Explorer.
 * Every file that can be deleted can be ticked (shift-click ticks a range,
 * the header ticks them all) and deleted together (#2423); "Delete
 * originals on D:" covers the whole bucket (#2110). A delete's confirmation
 * opens at once with the count and size listed here; every move or delete
 * is a `storageAction` (confirm, Sidecar Job). A delete Job that took
 * exactly what was listed is taken off the list; anything else (a move, a
 * delete that kept or left files) lists again.
 */
export namespace bucketPageReducer {
  /** A copy of a file a delete takes: where, which file, how big. */
  export type RemovedCopy = {
    readonly location: string;
    readonly path: string;
    readonly bytes: number;
    readonly file: StorageBucketFile;
  };

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
    /** When the listing shown completed (ms); null until one has. */
    fetchedAt: number | null;
    /** The ticked files (root-relative paths), in tick order. */
    selected: string[];
    /** The file last ticked or unticked: where a shift-click range starts. */
    anchor: string | null;
    /** The move or delete being asked for, up to its Job (#2157). */
    action: storageAction.State | null;
    nextRequestId: number;
    /** Storage Jobs seen running (true) or seen to settle (false). */
    watchedJobs: Record<string, boolean>;
    /** Delete Jobs started here, by Job id: the copies each should take. */
    pendingDeletes: Record<string, RemovedCopy[]>;
    /** The last thing that went wrong outside an action (Show in Explorer). */
    notice: string | null;
  };

  /** What a file's action menu offers. */
  export type FileChoice =
    | { type: "delete" }
    | { type: "move"; target: string }
    | { type: "delete-original"; from: string }
    | { type: "reveal"; location: string };

  export type Action =
    | Exclude<StorageBucketFilesMessage, { type: "scan-completed" }>
    | { type: "scan-completed"; at: number }
    | { type: "page-opened"; now: number; cached: CachedListing | null }
    | { type: "window-refocused"; now: number }
    | { type: "refresh-clicked" }
    | { type: "listing-failed"; message: string }
    | { type: "file-ticked"; path: string; shift: boolean }
    | { type: "tick-all-clicked" }
    | { type: "delete-selected-clicked" }
    | { type: "delete-originals-clicked"; from: string }
    | { type: "file-action-clicked"; path: string; choice: FileChoice }
    | { type: "reveal-failed"; message: string }
    | { type: "notice-dismissed" }
    | { type: "storage-jobs-observed"; jobs: ObservedStorageJob[] }
    | storageAction.Action;

  export type Effect =
    | { type: "listen-to-listing"; bucketId: string }
    | { type: "reveal-file"; location: string; path: string }
    | { type: "save-listing"; bucketId: string; listing: CachedListing }
    | {
        type: "forget-from-scan";
        bucketId: string;
        removed: RemovedBytes[];
      }
    | { type: "forget-scan" }
    | storageAction.Effect;
}

type State = bucketPageReducer.State;
type Action = bucketPageReducer.Action;
type Effect = bucketPageReducer.Effect;
type Exec = Parameters<EffectReducer<State, Action, Effect>>[2];
type RemovedCopy = bucketPageReducer.RemovedCopy;

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
  fetchedAt: null,
  selected: [],
  anchor: null,
  action: null,
  nextRequestId: 1,
  watchedJobs: {},
  pendingDeletes: {},
  notice: null,
});

/** Start listening. */
const listen = (state: State, exec: Exec): State => {
  if (state.listing) exec.stop(state.listing);
  return {
    ...state,
    listing: exec({ type: "listen-to-listing", bucketId: state.bucketId }),
  };
};

/** List again from nothing, keeping the action and the Jobs followed. */
const relist = (state: State, exec: Exec): State =>
  listen(
    {
      ...createInitialBucketPageState(state.bucketId),
      action: state.action,
      nextRequestId: state.nextRequestId,
      watchedJobs: state.watchedJobs,
      pendingDeletes: state.pendingDeletes,
      listing: state.listing,
    },
    exec
  );

/** What the cache keeps of a complete listing. */
const snapshotOf = (state: State, fetchedAt: number): CachedListing => ({
  fetchedAt,
  roots: state.roots,
  bucket: state.bucket,
  files: state.files,
  unreadableRoots: state.unreadableRoots,
});

/** Begin `request` as the page's one action, or change nothing. */
const begin = (
  state: State,
  request: storageAction.Request | null,
  exec: Exec
): State => {
  if (request === null) return state;
  const next = beginStorageAction(
    state.action,
    request,
    state.nextRequestId,
    exec,
    request.type === "move" ? null : deletePlanOf(copiesDeleted(state, request))
  );
  return next === null
    ? state
    : { ...state, action: next, nextRequestId: state.nextRequestId + 1 };
};

/** Storage Jobs that settled: forget what a delete took, or list again. */
const jobsSettled = (
  state: State,
  settled: readonly ObservedStorageJob[],
  exec: Exec
): State => {
  if (settled.length === 0) return state;
  let files = state.files;
  const removed: RemovedCopy[] = [];
  let listAgain = false;
  const pendingDeletes = { ...state.pendingDeletes };
  for (const job of settled) {
    const pending = pendingDeletes[job.id];
    delete pendingDeletes[job.id];
    const result = job.deleted;
    const tookExactly =
      pending !== undefined &&
      result != null &&
      result.left.length === 0 &&
      result.kept.files === 0 &&
      result.deleted.files === pending.length;
    if (tookExactly && state.status === "complete") {
      files = withoutCopies(files, pending!);
      removed.push(...pending!);
    } else listAgain = true;
  }
  const next = { ...state, files, pendingDeletes };
  if (listAgain) {
    // What changed is not known here: the Storage page counts again too.
    exec({ type: "forget-scan" });
    return relist(next, exec);
  }
  exec({
    type: "forget-from-scan",
    bucketId: state.bucketId,
    removed: removedBytesOf(removed),
  });
  if (next.fetchedAt !== null) {
    exec({
      type: "save-listing",
      bucketId: state.bucketId,
      listing: snapshotOf(next, next.fetchedAt),
    });
  }
  return next;
};

/** Tick or untick one file; with shift, tick every file from the anchor. */
const tick = (state: State, path: string, shift: boolean): State => {
  if (storageActionIsBusy(state.action)) return state;
  if (!fileCanBeTicked(state, path)) return state;
  if (shift && state.anchor !== null && state.anchor !== path) {
    const order = bucketFiles(state).map((f) => f.path);
    const from = order.indexOf(state.anchor);
    const to = order.indexOf(path);
    if (from !== -1 && to !== -1) {
      const range = order
        .slice(Math.min(from, to), Math.max(from, to) + 1)
        .filter(
          (p) => fileCanBeTicked(state, p) && !state.selected.includes(p)
        );
      return {
        ...state,
        selected: [...state.selected, ...range],
        anchor: path,
      };
    }
  }
  return {
    ...state,
    selected: state.selected.includes(path)
      ? state.selected.filter((p) => p !== path)
      : [...state.selected, path],
    anchor: path,
  };
};

/** Every gesture that starts a move or delete, and the Jobs the page follows. */
const actionReducer = (
  state: State,
  action: Action,
  exec: Exec
): State | null => {
  if (isStorageActionAction(action)) {
    const { state: next, startedJobId } = storageActionTransition(
      state.action,
      action,
      exec
    );
    if (next === state.action && startedJobId === null) return state;
    const started = state.action;
    const pending =
      startedJobId !== null && started?.status === "starting"
        ? copiesDeleted(state, started.request)
        : [];
    return {
      ...state,
      action: next,
      // A started delete of the ticked files: the ticks are done with.
      selected: startedJobId === null ? state.selected : [],
      anchor: startedJobId === null ? state.anchor : null,
      watchedJobs:
        startedJobId === null
          ? state.watchedJobs
          : { ...state.watchedJobs, [startedJobId]: true },
      pendingDeletes:
        startedJobId === null || pending.length === 0
          ? state.pendingDeletes
          : { ...state.pendingDeletes, [startedJobId]: pending },
    };
  }
  switch (action.type) {
    case "file-ticked":
      return tick(state, action.path, action.shift);
    case "tick-all-clicked": {
      if (storageActionIsBusy(state.action)) return state;
      const all = bucketFiles(state)
        .map((f) => f.path)
        .filter((p) => fileCanBeTicked(state, p));
      const allTicked = all.every((p) => state.selected.includes(p));
      return { ...state, selected: allTicked ? [] : all, anchor: null };
    }
    case "delete-selected-clicked": {
      if (state.status !== "complete" || state.bucket === null) return state;
      const files = state.selected.flatMap((p) => state.files[p] ?? []);
      return begin(state, deleteRequest(state.bucket, files), exec);
    }
    case "delete-originals-clicked": {
      if (state.bucket === null) return state;
      const offered = originalsOffers(state).some(
        (o) => o.location === action.from
      );
      if (!offered) return state;
      return begin(
        state,
        {
          type: "originals",
          bucket: state.bucket,
          from: action.from,
          paths: null,
        },
        exec
      );
    }
    case "file-action-clicked": {
      const file = state.files[action.path];
      if (state.status !== "complete" || state.bucket === null || !file)
        return state;
      const offered = fileActions(state, file).find(
        (a) => sameChoice(a.choice, action.choice) && a.refusal === null
      );
      if (!offered) return state;
      if (action.choice.type === "reveal") {
        exec({
          type: "reveal-file",
          location: action.choice.location,
          path: file.path,
        });
        return state;
      }
      return begin(state, fileRequest(state.bucket, file, action.choice), exec);
    }
    case "reveal-failed":
      return { ...state, notice: action.message };
    case "notice-dismissed":
      return { ...state, notice: null };
    case "storage-jobs-observed": {
      const { watched, settled } = watchStorageJobs(
        state.watchedJobs,
        action.jobs
      );
      return jobsSettled({ ...state, watchedJobs: watched }, settled, exec);
    }
    // The listing's and the freshness events: not an action's.
    case "page-opened":
    case "window-refocused":
    case "refresh-clicked":
    case "roots-measured":
    case "bucket-identified":
    case "files-found":
    case "root-unreadable":
    case "scan-completed":
    case "listing-failed":
      return null;
  }
};

/** Opening the page, coming back to it, and Refresh: when to list again. */
const freshnessReducer = (
  state: State,
  action: Action,
  exec: Exec
): State | null => {
  if (action.type === "page-opened") {
    // Opened again (Strict Mode remounts): one listener, the newest.
    const cached = action.cached;
    if (cached !== null && !isStale(cached.fetchedAt, action.now)) {
      if (state.listing) exec.stop(state.listing);
      return {
        ...state,
        ...cached,
        status: "complete",
        failure: null,
        listing: null,
      };
    }
    return listen(state, exec);
  }
  if (action.type !== "window-refocused" && action.type !== "refresh-clicked")
    return null;
  // Never under a listing walk or an open confirmation.
  if (state.status === "listing" || storageActionIsBusy(state.action))
    return state;
  if (action.type === "refresh-clicked") return relist(state, exec);
  return isStale(state.fetchedAt, action.now) ? relist(state, exec) : state;
};

export const bucketPageReducer: EffectReducer<State, Action, Effect> = (
  state,
  action,
  exec
) => {
  const afterFreshness = freshnessReducer(state, action, exec);
  if (afterFreshness !== null) return afterFreshness;
  const afterAction = actionReducer(state, action, exec);
  if (afterAction !== null) return afterAction;
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
    case "scan-completed": {
      if (state.listing) exec.stop(state.listing);
      const next: State = {
        ...state,
        status: "complete",
        listing: null,
        fetchedAt: action.at,
      };
      exec({
        type: "save-listing",
        bucketId: state.bucketId,
        listing: snapshotOf(next, action.at),
      });
      return next;
    }
    case "listing-failed":
      if (state.listing) exec.stop(state.listing);
      return {
        ...state,
        status: "failed",
        failure: action.message,
        listing: null,
      };
    case "page-opened":
    case "window-refocused":
    case "refresh-clicked":
    case "file-ticked":
    case "tick-all-clicked":
    case "delete-selected-clicked":
    case "delete-originals-clicked":
    case "file-action-clicked":
    case "reveal-failed":
    case "notice-dismissed":
    case "storage-jobs-observed":
    case "storage-action-planned":
    case "storage-action-confirmed":
    case "storage-action-cancelled":
    case "storage-action-started":
    case "storage-action-failed":
    case "storage-action-dismissed":
      // The action menus', the freshness and the Jobs' events, handled above.
      return state;
  }
};

// --- selectors ---------------------------------------------------------------

/** The ticked files' bytes, every copy added up: what a delete frees. */
export const selectedBytes = (state: State): number =>
  state.selected.reduce(
    (n, p) =>
      n +
      Object.values(state.files[p]?.copies ?? {}).reduce((m, b) => m + b, 0),
    0
  );

/** Whether every file that can be ticked is ticked (and there is one). */
export const allTicked = (state: State): boolean => {
  const tickable = Object.keys(state.files).filter((p) =>
    fileCanBeTicked(state, p)
  );
  return (
    tickable.length > 0 && tickable.every((p) => state.selected.includes(p))
  );
};

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
