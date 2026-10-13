import type { EffectEntity, EffectReducer } from "use-effect-reducer";
import type {
  StorageBucket,
  StorageFileKind,
  StorageRootReport,
  StorageScanMessage,
} from "@/packages/storage/buckets";

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
  };

  export type Action =
    StorageScanMessage | { type: "scan-failed"; message: string };

  export type Effect = { type: "listen-to-scan" };
}

type State = storagePageReducer.State;
type Action = storagePageReducer.Action;
type Effect = storagePageReducer.Effect;

const NO_BYTES: storagePageReducer.KindBytes = {
  footage: 0,
  "exported-videos": 0,
  other: 0,
};

export const createInitialStoragePageState = (
  exec: (effect: Effect) => EffectEntity<State, Action>
): State => ({
  status: "scanning",
  failure: null,
  roots: null,
  buckets: {},
  totals: {},
  unreadableRoots: {},
  scan: exec({ type: "listen-to-scan" }),
});

/** Stop listening: the scan is over, one way or the other. */
const stopScan = (
  state: State,
  exec: Parameters<EffectReducer<State, Action, Effect>>[2]
) => {
  if (state.scan) exec.stop(state.scan);
};

export const storagePageReducer: EffectReducer<State, Action, Effect> = (
  state,
  action,
  exec
) => {
  // A message after the scan has settled (a late event, or the browser
  // reporting the closed stream) changes nothing.
  if (state.status !== "scanning") return state;
  switch (action.type) {
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
