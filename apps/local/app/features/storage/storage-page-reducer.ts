import type { EffectEntity, EffectReducer } from "use-effect-reducer";
import {
  isExportPurgeAction,
  purgeIsBusy,
  purgeTransition,
  startPurge,
  type exportPurge,
} from "./export-purge";
import {
  bucketCanBeDeleted,
  bucketCanBePurged,
  movableKindsOf,
  moveTargetRefusal,
  type StorageMoveKind,
  type StorageMovePlan,
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
    /** Purging a bucket's Exported Videos (#2111): asked, under way, or done. */
    purge: exportPurge.State | null;
    /** Moving a bucket's files to another drive (#2109), up to its Job. */
    move: Move | null;
  };

  /**
   * One move confirmation at a time. `planning`: the server is counting what
   * would be copied and checking every refusal; `confirming`: the dialog shows
   * the size, the target's free space and any refusal (then it is blocked);
   * `starting`: the Job is being enqueued; `started`: it runs in the Sidecar
   * and shows in the Upload Manager, with its Cancel.
   */
  export type Move =
    | {
        status: "planning";
        bucket: StorageBucket;
        kind: StorageMoveKind;
        target: string;
      }
    | { status: "confirming"; plan: StorageMovePlan }
    | { status: "starting"; plan: StorageMovePlan }
    | { status: "started"; plan: StorageMovePlan; jobId: string }
    | { status: "failed"; bucket: StorageBucket; message: string };

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
    | { type: "deletion-dismissed" }
    | { type: "purge-bucket-clicked"; bucketId: string }
    | exportPurge.Action
    | {
        type: "move-clicked";
        bucketId: string;
        kind: StorageMoveKind;
        target: string;
      }
    | { type: "move-planned"; plan: StorageMovePlan }
    | { type: "move-plan-failed"; bucketId: string; message: string }
    | { type: "move-confirmed" }
    | { type: "move-cancelled" }
    | { type: "move-started"; jobId: string }
    | { type: "move-start-failed"; message: string }
    | { type: "move-dismissed" };

  export type Effect =
    | { type: "listen-to-scan" }
    | { type: "delete-bucket"; bucketId: string }
    | exportPurge.Effect
    | {
        type: "plan-move";
        bucketId: string;
        kind: StorageMoveKind;
        target: string;
      }
    | {
        type: "start-move";
        bucketId: string;
        kind: StorageMoveKind;
        target: string;
      };
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
  purge: null,
  move: null,
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
    purge: state.purge,
    move: state.move,
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
      if (purgeIsBusy(state.purge)) return state;
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
    case "purge-bucket-clicked":
    case "purge-planned":
    case "purge-confirmed":
    case "purge-cancelled":
    case "exports-purged":
    case "purge-failed":
    case "purge-dismissed":
      // The scan's and the Purge's events: not the delete's.
      return null;
    case "move-clicked":
    case "move-planned":
    case "move-plan-failed":
    case "move-confirmed":
    case "move-cancelled":
    case "move-started":
    case "move-start-failed":
    case "move-dismissed":
      // The move's events, handled by `moveReducer`.
      return null;
  }
};

/** The move half of the page: one confirmation at a time, up to its Job. */
const moveReducer = (
  state: State,
  action: Action,
  exec: Parameters<EffectReducer<State, Action, Effect>>[2]
): State | null => {
  const move = state.move;
  switch (action.type) {
    case "move-clicked": {
      if (
        move?.status === "planning" ||
        move?.status === "confirming" ||
        move?.status === "starting"
      )
        return state;
      const bucket = state.buckets[action.bucketId];
      if (!bucket || !movableKindsOf(bucket).includes(action.kind)) {
        return state;
      }
      exec({
        type: "plan-move",
        bucketId: bucket.id,
        kind: action.kind,
        target: action.target,
      });
      return {
        ...state,
        move: {
          status: "planning",
          bucket,
          kind: action.kind,
          target: action.target,
        },
      };
    }
    case "move-planned":
      if (
        move?.status !== "planning" ||
        move.bucket.id !== action.plan.bucketId ||
        move.kind !== action.plan.kind ||
        move.target !== action.plan.target
      )
        return state;
      return { ...state, move: { status: "confirming", plan: action.plan } };
    case "move-plan-failed":
      if (move?.status !== "planning" || move.bucket.id !== action.bucketId)
        return state;
      return {
        ...state,
        move: {
          status: "failed",
          bucket: move.bucket,
          message: action.message,
        },
      };
    case "move-confirmed":
      // A blocked move can't be confirmed: the button is off, and so is this.
      if (move?.status !== "confirming" || move.plan.refusals.length > 0)
        return state;
      exec({
        type: "start-move",
        bucketId: move.plan.bucketId,
        kind: move.plan.kind,
        target: move.plan.target,
      });
      return { ...state, move: { status: "starting", plan: move.plan } };
    case "move-cancelled":
      if (move?.status !== "confirming" && move?.status !== "planning")
        return state;
      return { ...state, move: null };
    case "move-started":
      if (move?.status !== "starting") return state;
      return {
        ...state,
        move: { status: "started", plan: move.plan, jobId: action.jobId },
      };
    case "move-start-failed": {
      if (move?.status !== "starting") return state;
      const bucket = state.buckets[move.plan.bucketId] ?? {
        id: move.plan.bucketId,
        kind: "course" as const,
        name: move.plan.bucketName,
      };
      return {
        ...state,
        move: { status: "failed", bucket, message: action.message },
      };
    }
    case "move-dismissed":
      if (move?.status !== "started" && move?.status !== "failed") return state;
      return { ...state, move: null };
    case "page-opened":
    case "roots-measured":
    case "buckets-listed":
    case "sizes-counted":
    case "root-unreadable":
    case "scan-completed":
    case "scan-failed":
    case "delete-bucket-clicked":
    case "delete-confirmed":
    case "delete-cancelled":
    case "bucket-deleted":
    case "bucket-delete-failed":
    case "deletion-dismissed":
    case "purge-bucket-clicked":
    case "purge-planned":
    case "purge-confirmed":
    case "purge-cancelled":
    case "exports-purged":
    case "purge-failed":
    case "purge-dismissed":
      // The scan's, the delete's and the Purge's events.
      return null;
  }
};

/**
 * The Purge half of the page (#2111): a Course's, Standalone Videos' or
 * Shorts' Exported Videos, one bucket at a time, never during a delete.
 */
const purgeReducer = (
  state: State,
  action: Action,
  exec: Parameters<EffectReducer<State, Action, Effect>>[2]
): State | null => {
  if (action.type === "purge-bucket-clicked") {
    // Offered once the count is complete, on a bucket with Exported Videos.
    if (state.status !== "complete") return state;
    if (
      state.deletion?.status === "confirming" ||
      state.deletion?.status === "deleting"
    )
      return state;
    const row = storageRows(state).find((r) => r.bucket.id === action.bucketId);
    if (!row || !rowCanBePurged(row)) return state;
    const purge = startPurge(state.purge, row.bucket, null, exec);
    return purge === null ? state : { ...state, purge };
  }
  if (!isExportPurgeAction(action)) return null;
  const next = purgeTransition(state.purge, action, exec);
  if (next.purge === state.purge) return state;
  const after = { ...state, purge: next.purge };
  return next.purged ? rescan(after, exec) : after;
};

export const storagePageReducer: EffectReducer<State, Action, Effect> = (
  state,
  action,
  exec
) => {
  const afterMove = moveReducer(state, action, exec);
  if (afterMove !== null) return afterMove;
  const afterDeletion = deletionReducer(state, action, exec);
  if (afterDeletion !== null) return afterDeletion;
  const afterPurge = purgeReducer(state, action, exec);
  if (afterPurge !== null) return afterPurge;
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
    case "purge-bucket-clicked":
    case "purge-planned":
    case "purge-confirmed":
    case "purge-cancelled":
    case "exports-purged":
    case "purge-failed":
    case "purge-dismissed":
      // The delete's and the Purge's events, handled above.
      return state;
    case "move-clicked":
    case "move-planned":
    case "move-plan-failed":
    case "move-confirmed":
    case "move-cancelled":
    case "move-started":
    case "move-start-failed":
    case "move-dismissed":
      // The move's events, handled by `moveReducer`.
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

/**
 * The move confirmation's numbers: the size to copy (files not already on
 * the target), the target's free space and what it would have left, and
 * whether the move is blocked (any refusal), naming each reason. Null when no
 * plan is shown.
 */
export const moveConfirmation = (
  state: State
): {
  plan: StorageMovePlan;
  bytesToCopy: number;
  freeBytes: number | null;
  freeAfter: number | null;
  blocked: boolean;
  reasons: string[];
  starting: boolean;
} | null => {
  const move = state.move;
  if (move?.status !== "confirming" && move?.status !== "starting") return null;
  const plan = move.plan;
  return {
    plan,
    bytesToCopy: plan.bytesToCopy,
    freeBytes: plan.freeBytes,
    freeAfter:
      plan.freeBytes === null ? null : plan.freeBytes - plan.bytesToCopy,
    blocked: plan.refusals.length > 0,
    reasons: plan.refusals.map((r) => r.message),
    starting: move.status === "starting",
  };
};
