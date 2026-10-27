import type { EffectEntity, EffectReducer } from "use-effect-reducer";
import {
  beginStorageAction,
  isStorageActionAction,
  storageActionTransition,
  type storageAction,
} from "./storage-action";
import { watchStorageJobs, type ObservedStorageJob } from "./storage-jobs";
import {
  bucketCanBeDeleted,
  bucketCanBePurged,
  movableKindsOf,
  moveTargetRefusal,
  type StorageMoveKind,
  type StorageBucket,
  type StorageFileKind,
  type StorageRootReport,
  type StorageScanMessage,
  type StorageTrashEntry,
} from "@/packages/storage/client";

/**
 * THE STORAGE PAGE (#2107): where the space is going, per Storage Bucket and
 * per Storage Root. Opening the page listens to the scan
 * (`/api/storage/scan`), which streams sizes as it counts them; leaving the
 * page closes the stream, and the server stops the walk. Nothing is cached:
 * every visit counts afresh. See docs/FRONTEND_STATE.md.
 *
 * Each row has one action menu (#2157): move its Footage, Exported Videos or
 * Clip Mockups to another drive, delete its Exported Videos, delete an Other
 * bucket, move Unused Footage to the Trash or empty the Trash. Each is a
 * `storageAction` (dry run, confirm, Sidecar Job). The page follows every
 * storage Job live from its Job Events and counts again when one it saw
 * running settles.
 */
export namespace storagePageReducer {
  /** Bytes per kind, at one location. */
  export type KindBytes = Record<StorageFileKind, number>;

  export type State = {
    status: "scanning" | "complete" | "failed";
    failure: string | null;
    /** Each Storage Root's size and free space; null until measured. */
    roots: StorageRootReport[] | null;
    buckets: Record<string, StorageBucket>;
    /** bucket id → location → bytes per kind, added up from the deltas. */
    totals: Record<string, Record<string, KindBytes>>;
    /** Roots the walk could not read, and why: shown with no sizes. */
    unreadableRoots: Record<string, string>;
    scan: EffectEntity<State, Action> | null;
    /** The move or delete being asked for, up to its Job (#2157). */
    action: storageAction.State | null;
    /** The next action's `requestId`. */
    nextRequestId: number;
    /** Storage Jobs seen running (true) or seen to settle (false). */
    watchedJobs: Record<string, boolean>;
    /** What is in the Trash (ADR 0043); null until listed. */
    trash: StorageTrashEntry[] | null;
    trashFailure: string | null;
  };

  /** What a row's action menu offers. */
  export type RowChoice =
    | { type: "move"; kind: StorageMoveKind; target: string }
    | { type: "purge" }
    | { type: "delete-bucket" }
    | { type: "trash-unused" };

  export type Action =
    | StorageScanMessage
    | { type: "page-opened" }
    | { type: "scan-failed"; message: string }
    | { type: "row-action-clicked"; bucketId: string; choice: RowChoice }
    | { type: "storage-jobs-observed"; jobs: ObservedStorageJob[] }
    | { type: "trash-listed"; entries: StorageTrashEntry[] }
    | { type: "trash-list-failed"; message: string }
    | { type: "empty-trash-clicked" }
    | storageAction.Action;

  export type Effect =
    { type: "listen-to-scan" } | { type: "load-trash" } | storageAction.Effect;
}

type State = storagePageReducer.State;
type Action = storagePageReducer.Action;
type Effect = storagePageReducer.Effect;
type Exec = Parameters<EffectReducer<State, Action, Effect>>[2];

const NO_BYTES: storagePageReducer.KindBytes = {
  footage: 0,
  "exported-videos": 0,
  other: 0,
};

/**
 * The page starts listening on `page-opened`, not here: a listener started
 * from the initial state is stopped by React Strict Mode's mount → unmount →
 * mount (client-side navigation in dev) and never started again.
 */
export const createInitialStoragePageState = (): State => ({
  status: "scanning",
  failure: null,
  roots: null,
  buckets: {},
  totals: {},
  unreadableRoots: {},
  scan: null,
  action: null,
  nextRequestId: 1,
  watchedJobs: {},
  trash: null,
  trashFailure: null,
});

/** Stop listening: the scan is over, one way or the other. */
const stopScan = (state: State, exec: Exec) => {
  if (state.scan) exec.stop(state.scan);
};

/** Count again from nothing: what a Job changed is counted afresh. */
const rescan = (state: State, exec: Exec): State => {
  stopScan(state, exec);
  exec({ type: "load-trash" });
  return {
    ...createInitialStoragePageState(),
    action: state.action,
    nextRequestId: state.nextRequestId,
    watchedJobs: state.watchedJobs,
    trash: state.trash,
    scan: exec({ type: "listen-to-scan" }),
  };
};

/** The request a row's choice makes, or null when the row doesn't offer it. */
const requestOf = (
  state: State,
  row: StorageRow,
  choice: storagePageReducer.RowChoice
): storageAction.Request | null => {
  const bucket = row.bucket;
  switch (choice.type) {
    case "move": {
      const offered = rowMoveActions(state, row).some(
        (m) =>
          m.kind === choice.kind &&
          m.target.root === choice.target &&
          m.refusal === null
      );
      return offered
        ? {
            type: "move",
            bucket,
            kind: choice.kind,
            target: choice.target,
            paths: null,
          }
        : null;
    }
    case "purge":
      return rowCanBePurged(row)
        ? { type: "purge", bucket, exportPaths: null }
        : null;
    case "delete-bucket":
      return bucketCanBeDeleted(bucket)
        ? { type: "delete-bucket", bucket, files: null }
        : null;
    case "trash-unused":
      return bucket.kind === "unused-footage"
        ? { type: "trash-unused", files: null }
        : null;
  }
};

/** The row menus, the action they start, and the Jobs the page follows. */
const actionReducer = (
  state: State,
  action: Action,
  exec: Exec
): State | null => {
  if (action.type === "row-action-clicked") {
    // Offered once the count is complete, so the sizes are known.
    if (state.status !== "complete") return state;
    const row = storageRows(state).find((r) => r.bucket.id === action.bucketId);
    const request = row ? requestOf(state, row, action.choice) : null;
    if (request === null) return state;
    const next = beginStorageAction(
      state.action,
      request,
      state.nextRequestId,
      exec
    );
    return next === null
      ? state
      : { ...state, action: next, nextRequestId: state.nextRequestId + 1 };
  }
  if (action.type === "empty-trash-clicked") {
    if ((state.trash ?? []).length === 0) return state;
    const next = beginStorageAction(
      state.action,
      { type: "empty-trash" },
      state.nextRequestId,
      exec
    );
    return next === null
      ? state
      : { ...state, action: next, nextRequestId: state.nextRequestId + 1 };
  }
  if (action.type === "trash-listed") {
    return { ...state, trash: action.entries, trashFailure: null };
  }
  if (action.type === "trash-list-failed") {
    return { ...state, trashFailure: action.message };
  }
  if (action.type === "storage-jobs-observed") {
    const { watched, settled } = watchStorageJobs(
      state.watchedJobs,
      action.jobs
    );
    const after = { ...state, watchedJobs: watched };
    return settled ? rescan(after, exec) : after;
  }
  if (!isStorageActionAction(action)) return null;
  const { state: next, startedJobId } = storageActionTransition(
    state.action,
    action,
    exec
  );
  if (next === state.action && startedJobId === null) return state;
  return {
    ...state,
    action: next,
    watchedJobs:
      startedJobId === null
        ? state.watchedJobs
        : { ...state.watchedJobs, [startedJobId]: true },
  };
};

export const storagePageReducer: EffectReducer<State, Action, Effect> = (
  state,
  action,
  exec
) => {
  const afterAction = actionReducer(state, action, exec);
  if (afterAction !== null) return afterAction;
  // A message after the scan has settled (a late event, or the browser
  // reporting the closed stream) changes nothing.
  if (state.status !== "scanning") return state;
  switch (action.type) {
    case "page-opened":
      // Opened again (Strict Mode remounts): one listener, the newest.
      stopScan(state, exec);
      exec({ type: "load-trash" });
      return { ...state, scan: exec({ type: "listen-to-scan" }) };
    case "roots-measured":
      return { ...state, roots: action.roots };
    case "buckets-listed":
      return {
        ...state,
        buckets: Object.fromEntries(action.buckets.map((b) => [b.id, b])),
      };
    case "sizes-counted": {
      const totals = { ...state.totals };
      for (const delta of action.sizes) {
        if (delta.location in state.unreadableRoots) continue;
        const byLocation = { ...totals[delta.bucketId] };
        const was = byLocation[delta.location] ?? NO_BYTES;
        byLocation[delta.location] = {
          ...was,
          [delta.kind]: was[delta.kind] + delta.bytes,
        };
        totals[delta.bucketId] = byLocation;
      }
      return { ...state, totals };
    }
    case "root-unreadable": {
      // A root that could not be read shows no sizes, not a partial count.
      const totals: State["totals"] = {};
      for (const [bucketId, byLocation] of Object.entries(state.totals)) {
        const { [action.root]: _dropped, ...rest } = byLocation;
        totals[bucketId] = rest;
      }
      return {
        ...state,
        totals,
        unreadableRoots: {
          ...state.unreadableRoots,
          [action.root]: action.message,
        },
      };
    }
    case "scan-completed":
      stopScan(state, exec);
      return { ...state, status: "complete", scan: null };
    case "scan-failed":
      stopScan(state, exec);
      return {
        ...state,
        status: "failed",
        failure: action.message,
        scan: null,
      };
    case "row-action-clicked":
    case "empty-trash-clicked":
    case "trash-listed":
    case "trash-list-failed":
    case "storage-jobs-observed":
    case "storage-action-planned":
    case "storage-action-confirmed":
    case "storage-action-cancelled":
    case "storage-action-started":
    case "storage-action-failed":
    case "storage-action-dismissed":
      // The action menu's and the Jobs' events, handled above.
      return state;
  }
};

// --- selectors ---------------------------------------------------------------

export type StorageRow = {
  bucket: StorageBucket;
  /** location → bytes per kind. */
  byLocation: Record<string, storagePageReducer.KindBytes>;
  /** Bytes per kind, every location added up. */
  bytes: storagePageReducer.KindBytes;
  totalBytes: number;
};

const sum = (
  a: storagePageReducer.KindBytes,
  b: storagePageReducer.KindBytes
) => ({
  footage: a.footage + b.footage,
  "exported-videos": a["exported-videos"] + b["exported-videos"],
  other: a.other + b.other,
});

/**
 * One row per Storage Bucket that has anything in it, largest first. The
 * order moves while the scan runs and settles once it completes.
 */
export const storageRows = (state: State): StorageRow[] =>
  Object.entries(state.totals)
    .flatMap(([bucketId, byLocation]): StorageRow[] => {
      const bucket = state.buckets[bucketId];
      if (!bucket) return [];
      const bytes = Object.values(byLocation).reduce(sum, NO_BYTES);
      const totalBytes = bytes.footage + bytes["exported-videos"] + bytes.other;
      if (totalBytes === 0) return [];
      return [{ bucket, byLocation, bytes, totalBytes }];
    })
    .sort(
      (a, b) =>
        b.totalBytes - a.totalBytes ||
        a.bucket.name.localeCompare(b.bucket.name)
    );

/**
 * Whether the row offers "Delete Exported Videos": a Course's, Standalone
 * Videos' or Shorts' bucket that has any.
 */
export const rowCanBePurged = (row: StorageRow): boolean =>
  bucketCanBePurged(row.bucket) && row.bytes["exported-videos"] > 0;

/**
 * The columns: each Storage Root in order, then any other folder CVM writes
 * to that the scan counted (export scratch).
 */
export const storageLocations = (state: State): string[] => {
  const roots = (state.roots ?? []).map((r) => r.root);
  const others = new Set<string>();
  for (const byLocation of Object.values(state.totals)) {
    for (const location of Object.keys(byLocation)) {
      if (!roots.includes(location)) others.add(location);
    }
  }
  return [...roots, ...[...others].sort()];
};

/**
 * The drive warnings at the top of the page: roots that are Offline
 * (unplugged, or can't be read), and online roots Windows reports Dirty.
 */
export const driveWarnings = (
  state: State
): {
  offline: Extract<StorageRootReport, { online: false }>[];
  dirty: StorageRootReport[];
} => {
  const roots = state.roots ?? [];
  return {
    offline: roots.filter(
      (r): r is Extract<StorageRootReport, { online: false }> => !r.online
    ),
    dirty: roots.filter((r) => r.online && r.dirtyBit === "dirty"),
  };
};

/** What one location shows in a row's Footage or Exported Videos cell. */
export type StorageCell =
  | { location: string; type: "offline" }
  | { location: string; type: "bytes"; bytes: number };

/**
 * A row's cell for one kind: a line per Storage Root (an Offline root reads
 * "Offline", never 0 GB, since its files can't be counted), plus any other
 * location that holds bytes of that kind.
 */
export const storageCells = (
  state: State,
  row: StorageRow,
  kind: StorageFileKind
): StorageCell[] =>
  storageLocations(state).flatMap((location): StorageCell[] => {
    const root = state.roots?.find((r) => r.root === location);
    if (root && !root.online) return [{ location, type: "offline" }];
    const bytes = row.byLocation[location]?.[kind] ?? 0;
    if (!root && bytes === 0) return [];
    return [{ location, type: "bytes", bytes }];
  });

/**
 * Each Storage Root as a move target, with why a move may not go there (an
 * Offline root), or null when it may.
 */
export const moveTargets = (
  state: State
): { root: StorageRootReport; refusal: string | null }[] =>
  (state.roots ?? []).map((root) => ({
    root,
    refusal: moveTargetRefusal(root),
  }));

/** Where each kind a move carries is counted on the page. */
const SCAN_KIND_OF: Record<StorageMoveKind, StorageFileKind> = {
  footage: "footage",
  "exported-videos": "exported-videos",
  "clip-mockups": "other",
};

/**
 * The move buttons a row offers: each kind the bucket can move, to each
 * Storage Root that does not already hold all of it, with why it can't go
 * there (an Offline root) or null.
 */
export const rowMoveActions = (
  state: State,
  row: StorageRow
): {
  kind: StorageMoveKind;
  target: StorageRootReport;
  refusal: string | null;
}[] =>
  movableKindsOf(row.bucket).flatMap((kind) =>
    moveTargets(state).flatMap(({ root, refusal }) => {
      const scanKind = SCAN_KIND_OF[kind];
      const elsewhere = Object.entries(row.byLocation).some(
        ([location, bytes]) => location !== root.root && bytes[scanKind] > 0
      );
      return elsewhere ? [{ kind, target: root, refusal }] : [];
    })
  );
