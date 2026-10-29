import type { EffectEntity, EffectReducer } from "use-effect-reducer";
import {
  beginStorageAction,
  deletePlanFiles,
  isStorageActionAction,
  storageActionIsBusy,
  storageActionTransition,
  type storageAction,
} from "./storage-action";
import {
  isStale,
  NO_BYTES,
  type CachedScan,
  type KindBytes,
} from "./storage-cache";
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
} from "@/packages/storage/client";

/**
 * THE STORAGE PAGE (#2107): where the space is going, per Storage Bucket and
 * per Storage Root. The scan (`/api/storage/scan`) streams sizes as it
 * counts them; leaving the page closes the stream, and the server stops the
 * walk. See docs/FRONTEND_STATE.md.
 *
 * What a scan found is kept in the Storage cache (#2423,
 * `storage-cache.ts`): opening the page shows it when it is under five
 * minutes old, and scans when it is older. The page never scans again on
 * its own while it is being looked at; a refocus scans only stale data, and
 * Refresh scans at once.
 *
 * Each row has one action menu (#2157): move its Footage, Exported Videos or
 * Clip Mockups to another drive, delete its Exported Videos, delete an Other
 * bucket, or delete all Unused Footage. Each is a `storageAction`; a
 * delete's confirmation opens at once with the size the scan counted. The
 * page follows every storage Job live from its Job Events. A delete that
 * took exactly what was counted is taken off the rows; anything else (a
 * move, a delete that kept or left files) counts again.
 */
export namespace storagePageReducer {
  /** Bytes per kind, at one location. */
  export type KindBytes = Record<StorageFileKind, number>;

  /** A delete started here: what the page expects it to take. */
  export type PendingDelete = {
    bucketId: string;
    kinds: StorageFileKind[];
    files: number;
  };

  export type State = {
    status: "scanning" | "complete" | "failed";
    failure: string | null;
    /** Each Storage Root's size and free space; null until measured. */
    roots: StorageRootReport[] | null;
    buckets: Record<string, StorageBucket>;
    /** bucket id → location → bytes per kind, added up from the deltas. */
    totals: Record<string, Record<string, KindBytes>>;
    /** bucket id → location → files per kind, added up from the deltas. */
    counts: Record<string, Record<string, KindBytes>>;
    /** Roots the walk could not read, and why: shown with no sizes. */
    unreadableRoots: Record<string, string>;
    scan: EffectEntity<State, Action> | null;
    /** When the scan shown completed (ms); null until one has. */
    fetchedAt: number | null;
    /** The move or delete being asked for, up to its Job (#2157). */
    action: storageAction.State | null;
    /** The next action's `requestId`. */
    nextRequestId: number;
    /** Storage Jobs seen running (true) or seen to settle (false). */
    watchedJobs: Record<string, boolean>;
    /** Delete Jobs started here, by Job id. */
    pendingDeletes: Record<string, PendingDelete>;
  };

  /** What a row's action menu offers. */
  export type RowChoice =
    | { type: "move"; kind: StorageMoveKind; target: string }
    | { type: "purge" }
    | { type: "delete-bucket" }
    | { type: "delete-unused" };

  export type Action =
    | Exclude<StorageScanMessage, { type: "scan-completed" }>
    | { type: "scan-completed"; at: number }
    | { type: "page-opened"; now: number; cached: CachedScan | null }
    | { type: "window-refocused"; now: number }
    | { type: "refresh-clicked" }
    | { type: "scan-failed"; message: string }
    | { type: "row-action-clicked"; bucketId: string; choice: RowChoice }
    | { type: "storage-jobs-observed"; jobs: ObservedStorageJob[] }
    | storageAction.Action;

  export type Effect =
    | { type: "listen-to-scan" }
    | { type: "save-scan"; scan: CachedScan }
    | { type: "forget-listing"; bucketId: string }
    | storageAction.Effect;
}

type State = storagePageReducer.State;
type Action = storagePageReducer.Action;
type Effect = storagePageReducer.Effect;
type Exec = Parameters<EffectReducer<State, Action, Effect>>[2];

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
  counts: {},
  unreadableRoots: {},
  scan: null,
  fetchedAt: null,
  action: null,
  nextRequestId: 1,
  watchedJobs: {},
  pendingDeletes: {},
});

/** Stop listening: the scan is over, one way or the other. */
const stopScan = (state: State, exec: Exec) => {
  if (state.scan) exec.stop(state.scan);
};

/** Count again from nothing, keeping the action and the Jobs followed. */
const rescan = (state: State, exec: Exec): State => {
  stopScan(state, exec);
  return {
    ...createInitialStoragePageState(),
    action: state.action,
    nextRequestId: state.nextRequestId,
    watchedJobs: state.watchedJobs,
    pendingDeletes: state.pendingDeletes,
    scan: exec({ type: "listen-to-scan" }),
  };
};

/** What the cache keeps of a complete scan. */
const snapshotOf = (state: State, fetchedAt: number): CachedScan => ({
  fetchedAt,
  roots: state.roots,
  buckets: state.buckets,
  totals: state.totals,
  counts: state.counts,
  unreadableRoots: state.unreadableRoots,
});

/** Which kinds a bucket-level delete takes. */
const KINDS_DELETED: Record<
  Exclude<storagePageReducer.RowChoice["type"], "move">,
  StorageFileKind[]
> = {
  purge: ["exported-videos"],
  "delete-bucket": ["footage", "exported-videos", "other"],
  "delete-unused": ["footage"],
};

/** A bucket-level delete's confirmation, from what the scan counted. */
const deletePlanOf = (
  state: State,
  bucketId: string,
  kinds: readonly StorageFileKind[]
): storageAction.DeletePlan => ({
  type: "delete",
  byLocation: Object.entries(state.totals[bucketId] ?? {})
    .map(([location, bytes]) => ({
      location,
      files: kinds.reduce(
        (n, k) => n + (state.counts[bucketId]?.[location]?.[k] ?? 0),
        0
      ),
      bytes: kinds.reduce((n, k) => n + bytes[k], 0),
    }))
    .filter((l) => l.bytes > 0 || l.files > 0),
});

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
    case "delete-unused":
      return bucket.kind === "unused-footage"
        ? { type: "delete-unused", files: null }
        : null;
  }
};

/** The bucket's `kinds` taken off the rows, as a delete took them. */
const withoutKinds = (
  state: State,
  bucketId: string,
  kinds: readonly StorageFileKind[]
): State => {
  const zero = (table: State["totals"]) => {
    const byLocation: Record<string, KindBytes> = {};
    for (const [location, was] of Object.entries(table[bucketId] ?? {})) {
      const next = { ...was };
      for (const k of kinds) next[k] = 0;
      byLocation[location] = next;
    }
    return { ...table, [bucketId]: byLocation };
  };
  return { ...state, totals: zero(state.totals), counts: zero(state.counts) };
};

/** Whether a settled delete took exactly what the page expected. */
const tookWhatWasCounted = (
  pending: storagePageReducer.PendingDelete | undefined,
  job: ObservedStorageJob
) =>
  pending !== undefined &&
  job.deleted != null &&
  job.deleted.left.length === 0 &&
  job.deleted.kept.files === 0 &&
  job.deleted.deleted.files === pending.files;

/** Storage Jobs that settled: forget what a delete took, or count again. */
const jobsSettled = (
  state: State,
  settled: readonly ObservedStorageJob[],
  exec: Exec
): State => {
  if (settled.length === 0) return state;
  let next = state;
  let countAgain = false;
  const pendingDeletes = { ...state.pendingDeletes };
  for (const job of settled) {
    const pending = pendingDeletes[job.id];
    delete pendingDeletes[job.id];
    if (pending !== undefined) {
      exec({ type: "forget-listing", bucketId: pending.bucketId });
    }
    if (tookWhatWasCounted(pending, job) && next.status === "complete") {
      next = withoutKinds(next, pending!.bucketId, pending!.kinds);
    } else countAgain = true;
  }
  next = { ...next, pendingDeletes };
  if (countAgain) return rescan(next, exec);
  if (next.fetchedAt !== null) {
    exec({ type: "save-scan", scan: snapshotOf(next, next.fetchedAt) });
  }
  return next;
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
    const plan =
      action.choice.type === "move"
        ? null
        : deletePlanOf(
            state,
            action.bucketId,
            KINDS_DELETED[action.choice.type]
          );
    const next = beginStorageAction(
      state.action,
      request,
      state.nextRequestId,
      exec,
      plan
    );
    return next === null
      ? state
      : { ...state, action: next, nextRequestId: state.nextRequestId + 1 };
  }
  if (action.type === "storage-jobs-observed") {
    const { watched, settled } = watchStorageJobs(
      state.watchedJobs,
      action.jobs
    );
    return jobsSettled({ ...state, watchedJobs: watched }, settled, exec);
  }
  if (!isStorageActionAction(action)) return null;
  const { state: next, startedJobId } = storageActionTransition(
    state.action,
    action,
    exec
  );
  if (next === state.action && startedJobId === null) return state;
  const started = state.action;
  const pending: storagePageReducer.PendingDelete | null =
    startedJobId !== null &&
    started?.status === "starting" &&
    started.plan.type === "delete" &&
    started.request.type !== "move" &&
    started.request.type !== "originals"
      ? {
          bucketId:
            started.request.type === "delete-unused"
              ? "unused-footage"
              : started.request.bucket.id,
          kinds: KINDS_DELETED[started.request.type],
          files: deletePlanFiles(started.plan),
        }
      : null;
  return {
    ...state,
    action: next,
    watchedJobs:
      startedJobId === null
        ? state.watchedJobs
        : { ...state.watchedJobs, [startedJobId]: true },
    pendingDeletes:
      startedJobId === null || pending === null
        ? state.pendingDeletes
        : { ...state.pendingDeletes, [startedJobId]: pending },
  };
};

/** Opening the page, coming back to it, and Refresh: when to count again. */
const freshnessReducer = (
  state: State,
  action: Action,
  exec: Exec
): State | null => {
  if (action.type === "page-opened") {
    // Opened again (Strict Mode remounts): one listener, the newest.
    stopScan(state, exec);
    const cached = action.cached;
    if (cached !== null && !isStale(cached.fetchedAt, action.now)) {
      return {
        ...state,
        ...cached,
        status: "complete",
        failure: null,
        scan: null,
      };
    }
    return { ...state, scan: exec({ type: "listen-to-scan" }) };
  }
  if (action.type !== "window-refocused" && action.type !== "refresh-clicked")
    return null;
  // Never under a scanning walk or an open confirmation.
  if (state.status === "scanning" || storageActionIsBusy(state.action))
    return state;
  if (action.type === "refresh-clicked") return rescan(state, exec);
  return isStale(state.fetchedAt, action.now) ? rescan(state, exec) : state;
};

const addUp = (
  table: State["totals"],
  delta: { bucketId: string; location: string; kind: StorageFileKind },
  amount: number
): State["totals"] => {
  const byLocation = { ...table[delta.bucketId] };
  const was = byLocation[delta.location] ?? NO_BYTES;
  byLocation[delta.location] = {
    ...was,
    [delta.kind]: was[delta.kind] + amount,
  };
  return { ...table, [delta.bucketId]: byLocation };
};

export const storagePageReducer: EffectReducer<State, Action, Effect> = (
  state,
  action,
  exec
) => {
  const afterFreshness = freshnessReducer(state, action, exec);
  if (afterFreshness !== null) return afterFreshness;
  const afterAction = actionReducer(state, action, exec);
  if (afterAction !== null) return afterAction;
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
      let totals = state.totals;
      let counts = state.counts;
      for (const delta of action.sizes) {
        if (delta.location in state.unreadableRoots) continue;
        totals = addUp(totals, delta, delta.bytes);
        counts = addUp(counts, delta, delta.files);
      }
      return { ...state, totals, counts };
    }
    case "root-unreadable": {
      // A root that could not be read shows no sizes, not a partial count.
      const drop = (table: State["totals"]) => {
        const out: State["totals"] = {};
        for (const [bucketId, byLocation] of Object.entries(table)) {
          const { [action.root]: _dropped, ...rest } = byLocation;
          out[bucketId] = rest;
        }
        return out;
      };
      return {
        ...state,
        totals: drop(state.totals),
        counts: drop(state.counts),
        unreadableRoots: {
          ...state.unreadableRoots,
          [action.root]: action.message,
        },
      };
    }
    case "scan-completed": {
      stopScan(state, exec);
      const next: State = {
        ...state,
        status: "complete",
        scan: null,
        fetchedAt: action.at,
      };
      exec({ type: "save-scan", scan: snapshotOf(next, action.at) });
      return next;
    }
    case "scan-failed":
      stopScan(state, exec);
      return {
        ...state,
        status: "failed",
        failure: action.message,
        scan: null,
      };
    case "page-opened":
    case "window-refocused":
    case "refresh-clicked":
    case "row-action-clicked":
    case "storage-jobs-observed":
    case "storage-action-planned":
    case "storage-action-confirmed":
    case "storage-action-cancelled":
    case "storage-action-started":
    case "storage-action-failed":
    case "storage-action-dismissed":
      // Handled above.
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
