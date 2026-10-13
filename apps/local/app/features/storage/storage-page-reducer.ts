import type { EffectEntity, EffectReducer } from "use-effect-reducer";
import {
  bucketCanBeDeleted,
  moveTargetRefusal,
  type StorageBucket,
  type StorageDeleteResult,
  type StorageFileKind,
  type StorageRootReport,
  type StorageScanMessage,
} from "@/packages/storage/client";

/**
 * THE STORAGE PAGE (#2107): where the space is going, per Storage Bucket and
 * per Storage Root. Opening the page listens to the scan
 * (`/api/storage/scan`), which streams sizes as it counts them; leaving the
 * page closes the stream, and the server stops the walk. Nothing is cached:
 * every visit counts afresh. See docs/FRONTEND_STATE.md.
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
    /** Deleting an Other bucket's files (#2112): asked, under way, or done. */
    deletion: Deletion | null;
  };

  /**
   * One delete at a time. `bytes` is what the scan counted in the bucket when
   * Delete was clicked: the GB the confirmation says it frees.
   */
  export type Deletion =
    | { status: "confirming"; bucket: StorageBucket; bytes: number }
    | { status: "deleting"; bucket: StorageBucket; bytes: number }
    | { status: "deleted"; bucket: StorageBucket; result: StorageDeleteResult }
    | { status: "failed"; bucket: StorageBucket; message: string };

  export type Action =
    | StorageScanMessage
    | { type: "page-opened" }
    | { type: "scan-failed"; message: string }
    | { type: "delete-bucket-clicked"; bucketId: string }
    | { type: "delete-confirmed" }
    | { type: "delete-cancelled" }
    | { type: "bucket-deleted"; result: StorageDeleteResult }
    | { type: "bucket-delete-failed"; bucketId: string; message: string }
    | { type: "deletion-dismissed" };

  export type Effect =
    { type: "listen-to-scan" } | { type: "delete-bucket"; bucketId: string };
}

type State = storagePageReducer.State;
type Action = storagePageReducer.Action;
type Effect = storagePageReducer.Effect;

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
  deletion: null,
});

/** Stop listening: the scan is over, one way or the other. */
const stopScan = (
  state: State,
  exec: Parameters<EffectReducer<State, Action, Effect>>[2]
) => {
  if (state.scan) exec.stop(state.scan);
};

/** Count again from nothing: what a delete changed is counted afresh. */
const rescan = (
  state: State,
  exec: Parameters<EffectReducer<State, Action, Effect>>[2]
): State => {
  stopScan(state, exec);
  return {
    ...createInitialStoragePageState(),
    deletion: state.deletion,
    scan: exec({ type: "listen-to-scan" }),
  };
};

/** The delete half of the page: Other buckets only, one at a time. */
const deletionReducer = (
  state: State,
  action: Action,
  exec: Parameters<EffectReducer<State, Action, Effect>>[2]
): State | null => {
  const deletion = state.deletion;
  switch (action.type) {
    case "delete-bucket-clicked": {
      // Offered once the count is complete, so the GB it frees is known.
      if (state.status !== "complete") return state;
      if (deletion?.status === "confirming" || deletion?.status === "deleting")
        return state;
      const row = storageRows(state).find(
        (r) => r.bucket.id === action.bucketId
      );
      if (!row || !bucketCanBeDeleted(row.bucket)) return state;
      return {
        ...state,
        deletion: {
          status: "confirming",
          bucket: row.bucket,
          bytes: row.totalBytes,
        },
      };
    }
    case "delete-confirmed":
      if (deletion?.status !== "confirming") return state;
      exec({ type: "delete-bucket", bucketId: deletion.bucket.id });
      return { ...state, deletion: { ...deletion, status: "deleting" } };
    case "delete-cancelled":
      if (deletion?.status !== "confirming") return state;
      return { ...state, deletion: null };
    case "bucket-deleted":
      if (
        deletion?.status !== "deleting" ||
        deletion.bucket.id !== action.result.bucketId
      )
        return state;
      return rescan(
        {
          ...state,
          deletion: {
            status: "deleted",
            bucket: deletion.bucket,
            result: action.result,
          },
        },
        exec
      );
    case "bucket-delete-failed":
      if (
        deletion?.status !== "deleting" ||
        deletion.bucket.id !== action.bucketId
      )
        return state;
      return {
        ...state,
        deletion: {
          status: "failed",
          bucket: deletion.bucket,
          message: action.message,
        },
      };
    case "deletion-dismissed":
      if (deletion?.status !== "deleted" && deletion?.status !== "failed")
        return state;
      return { ...state, deletion: null };
    case "page-opened":
    case "roots-measured":
    case "buckets-listed":
    case "sizes-counted":
    case "root-unreadable":
    case "scan-completed":
    case "scan-failed":
      // The scan's events: not the delete's.
      return null;
  }
};

export const storagePageReducer: EffectReducer<State, Action, Effect> = (
  state,
  action,
  exec
) => {
  const afterDeletion = deletionReducer(state, action, exec);
  if (afterDeletion !== null) return afterDeletion;
  // A message after the scan has settled (a late event, or the browser
  // reporting the closed stream) changes nothing.
  if (state.status !== "scanning") return state;
  switch (action.type) {
    case "page-opened":
      // Opened again (Strict Mode remounts): one listener, the newest.
      stopScan(state, exec);
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
    case "delete-bucket-clicked":
    case "delete-confirmed":
    case "delete-cancelled":
    case "bucket-deleted":
    case "bucket-delete-failed":
    case "deletion-dismissed":
      // The delete's events, handled above.
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
  offline: StorageRootReport[];
  dirty: StorageRootReport[];
} => {
  const roots = state.roots ?? [];
  return {
    offline: roots.filter((r) => !r.online),
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
