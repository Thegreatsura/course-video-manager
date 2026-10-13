import type { EffectEntity, EffectReducer } from "use-effect-reducer";
import {
  beginStorageAction,
  isStorageActionAction,
  storageActionIsBusy,
  storageActionTransition,
  type storageAction,
} from "./storage-action";
import { watchStorageJobs, type ObservedStorageJob } from "./storage-jobs";
import {
  addFoundFiles,
  bucketCanBeDeleted,
  bucketCanBePurged,
  dropFilesAt,
  largestFirst,
  movableKindsOf,
  originalsAt,
  type StorageBucket,
  type StorageBucketFile,
  type StorageBucketFilesMessage,
  type StorageMoveKind,
  type StorageRootReport,
  type StorageTrashEntry,
} from "@/packages/storage/client";

/**
 * THE PER-BUCKET PAGE (#2108): one Storage Bucket's files, largest first,
 * each with the drive(s) it is on and what it is. Opening the page listens
 * to the listing (`/api/storage/buckets/:bucketId/files`), which streams
 * files as the walk finds them; leaving the page closes the stream, and the
 * server stops the walk. Nothing is cached. See docs/FRONTEND_STATE.md.
 *
 * Each file has an action menu (#2157) with what its bucket allows: Delete
 * (an Exported Video whose Footage is found, an Other bucket's file, or
 * Unused Footage, which goes to the Trash), Move to another drive, Delete
 * original (only where an identical copy is on another drive), and Show in
 * Explorer. Exported Videos can still be ticked and deleted together, and
 * "Delete originals on D:" covers the whole bucket (#2110). Every move or
 * delete is a `storageAction` (dry run, confirm, Sidecar Job); the page
 * follows the bucket's storage Jobs live and lists again when one settles.
 * Unused Footage's page also lists the Trash, to Restore from or empty.
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
    /** The move or delete being asked for, up to its Job (#2157). */
    action: storageAction.State | null;
    nextRequestId: number;
    /** Storage Jobs seen running (true) or seen to settle (false). */
    watchedJobs: Record<string, boolean>;
    /** The Trash, on Unused Footage's page; null elsewhere or until listed. */
    trash: StorageTrashEntry[] | null;
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
    | StorageBucketFilesMessage
    | { type: "page-opened" }
    | { type: "listing-failed"; message: string }
    | { type: "export-checkbox-toggled"; path: string }
    | { type: "purge-selected-clicked" }
    | { type: "delete-originals-clicked"; from: string }
    | { type: "file-action-clicked"; path: string; choice: FileChoice }
    | { type: "restore-clicked"; entries: StorageTrashEntry[] }
    | { type: "empty-trash-clicked" }
    | { type: "trash-listed"; entries: StorageTrashEntry[] }
    | { type: "trash-list-failed"; message: string }
    | { type: "reveal-failed"; message: string }
    | { type: "notice-dismissed" }
    | { type: "storage-jobs-observed"; jobs: ObservedStorageJob[] }
    | storageAction.Action;

  export type Effect =
    | { type: "listen-to-listing"; bucketId: string }
    | { type: "load-trash" }
    | { type: "reveal-file"; location: string; path: string }
    | storageAction.Effect;
}

type State = bucketPageReducer.State;
type Action = bucketPageReducer.Action;
type Effect = bucketPageReducer.Effect;
type Exec = Parameters<EffectReducer<State, Action, Effect>>[2];

const UNUSED_FOOTAGE = "unused-footage";

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
  action: null,
  nextRequestId: 1,
  watchedJobs: {},
  trash: null,
  notice: null,
});

/** Start listening (and, on Unused Footage's page, list the Trash). */
const listen = (state: State, exec: Exec): State => {
  if (state.listing) exec.stop(state.listing);
  if (state.bucketId === UNUSED_FOOTAGE) exec({ type: "load-trash" });
  return {
    ...state,
    listing: exec({ type: "listen-to-listing", bucketId: state.bucketId }),
  };
};

/** List again from nothing: what a Job moved or deleted is listed afresh. */
const relist = (state: State, exec: Exec): State =>
  listen(
    {
      ...createInitialBucketPageState(state.bucketId),
      action: state.action,
      nextRequestId: state.nextRequestId,
      watchedJobs: state.watchedJobs,
      trash: state.trash,
      listing: state.listing,
    },
    exec
  );

/** Whether the file can be ticked: an Exported Video of a purgeable bucket. */
export const fileCanBeTicked = (state: State, path: string): boolean =>
  state.bucket !== null &&
  bucketCanBePurged(state.bucket) &&
  state.files[path]?.role === "exported-video";

/** What a move of this file carries, or null for a file moved with another. */
const moveKindOf = (file: StorageBucketFile): StorageMoveKind | null => {
  switch (file.role) {
    case "footage":
    case "recording-session":
      return "footage";
    case "exported-video":
      return "exported-videos";
    case "clip-mockup":
      return "clip-mockups";
    // Moved with the file they sit beside, or never moved.
    case "footage-companion":
    case "export-companion":
    case "overlay-render":
    case "export-scratch":
      return null;
  }
};

/** One entry of a file's action menu. */
export type FileAction = {
  readonly choice: bucketPageReducer.FileChoice;
  /** Verb-first Title Case, no ellipsis (the menu adds it). */
  readonly label: string;
  /** Which drive it is about, when that needs saying. */
  readonly description?: string;
  /** Why it is offered but can't be done now, or null. */
  readonly refusal: string | null;
};

const labelOfRoot = (state: State, location: string) =>
  state.roots?.find((r) => r.root === location)?.label ?? location;

/**
 * A file's action menu, with exactly what its bucket allows (#2157). The
 * server checks every one again.
 */
export const fileActions = (
  state: State,
  file: StorageBucketFile
): FileAction[] => {
  const bucket = state.bucket;
  if (bucket === null) return [];
  const out: FileAction[] = [];
  const kind = moveKindOf(file);
  const deletable =
    bucket.kind === UNUSED_FOOTAGE
      ? "Move to Trash"
      : bucketCanBePurged(bucket) && file.role === "exported-video"
        ? "Delete Exported Video"
        : bucketCanBeDeleted(bucket) && file.role !== "export-companion"
          ? "Delete"
          : null;
  if (deletable !== null) {
    out.push({ choice: { type: "delete" }, label: deletable, refusal: null });
  }
  if (kind !== null && movableKindsOf(bucket).includes(kind)) {
    for (const root of state.roots ?? []) {
      if (root.root in file.copies) continue;
      out.push({
        choice: { type: "move", target: root.root },
        label: `Move to ${root.label}`,
        refusal: root.online ? null : `${root.label} is Offline`,
      });
    }
  }
  if (movableKindsOf(bucket).length > 0) {
    for (const [from, bytes] of Object.entries(file.copies)) {
      const copied = Object.entries(file.copies).some(
        ([at, size]) => at !== from && size === bytes
      );
      if (!copied) continue;
      out.push({
        choice: { type: "delete-original", from },
        label: `Delete Original on ${labelOfRoot(state, from)}`,
        refusal: null,
      });
    }
  }
  for (const location of Object.keys(file.copies)) {
    out.push({
      choice: { type: "reveal", location },
      label: "Reveal in File System",
      description: labelOfRoot(state, location),
      refusal: null,
    });
  }
  return out;
};

const sameChoice = (
  a: bucketPageReducer.FileChoice,
  b: bucketPageReducer.FileChoice
) => JSON.stringify(a) === JSON.stringify(b);

/** Every copy of a file, as the server names a file on a drive. */
const copiesOf = (file: StorageBucketFile): storageAction.FileAt[] =>
  Object.keys(file.copies).map((location) => ({ location, path: file.path }));

/** The request a file's chosen action makes. */
const fileRequest = (
  bucket: StorageBucket,
  file: StorageBucketFile,
  choice: Exclude<bucketPageReducer.FileChoice, { type: "reveal" }>
): storageAction.Request | null => {
  switch (choice.type) {
    case "delete":
      if (bucket.kind === UNUSED_FOOTAGE) {
        return { type: "trash-unused", files: copiesOf(file) };
      }
      if (bucketCanBePurged(bucket)) {
        return { type: "purge", bucket, exportPaths: [file.path] };
      }
      return { type: "delete-bucket", bucket, files: copiesOf(file) };
    case "move": {
      const kind = moveKindOf(file);
      return kind === null
        ? null
        : {
            type: "move",
            bucket,
            kind,
            target: choice.target,
            paths: [file.path],
          };
    }
    case "delete-original":
      return {
        type: "originals",
        bucket,
        from: choice.from,
        paths: [file.path],
      };
  }
};

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
    exec
  );
  return next === null
    ? state
    : { ...state, action: next, nextRequestId: state.nextRequestId + 1 };
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
    return {
      ...state,
      action: next,
      // A started Purge of the ticked files: the ticks are done with.
      selected: startedJobId === null ? state.selected : [],
      watchedJobs:
        startedJobId === null
          ? state.watchedJobs
          : { ...state.watchedJobs, [startedJobId]: true },
    };
  }
  switch (action.type) {
    case "export-checkbox-toggled": {
      if (storageActionIsBusy(state.action)) return state;
      if (state.selected.includes(action.path)) {
        return {
          ...state,
          selected: state.selected.filter((p) => p !== action.path),
        };
      }
      if (!fileCanBeTicked(state, action.path)) return state;
      return { ...state, selected: [...state.selected, action.path] };
    }
    case "purge-selected-clicked":
      if (state.status !== "complete" || state.bucket === null) return state;
      if (state.selected.length === 0 || !bucketCanBePurged(state.bucket))
        return state;
      return begin(
        state,
        {
          type: "purge",
          bucket: state.bucket,
          exportPaths: [...state.selected],
        },
        exec
      );
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
    case "restore-clicked":
      if (action.entries.length === 0) return state;
      return begin(
        state,
        {
          type: "restore-trash",
          files: action.entries.map((e) => ({
            location: e.location,
            batch: e.batch,
            path: e.path,
          })),
        },
        exec
      );
    case "empty-trash-clicked":
      if ((state.trash ?? []).length === 0) return state;
      return begin(state, { type: "empty-trash" }, exec);
    case "trash-listed":
      return { ...state, trash: action.entries };
    case "trash-list-failed":
    case "reveal-failed":
      return { ...state, notice: action.message };
    case "notice-dismissed":
      return { ...state, notice: null };
    case "storage-jobs-observed": {
      const { watched, settled } = watchStorageJobs(
        state.watchedJobs,
        action.jobs
      );
      const after = { ...state, watchedJobs: watched };
      return settled ? relist(after, exec) : after;
    }
    // The listing's own events: not an action's.
    case "page-opened":
    case "roots-measured":
    case "bucket-identified":
    case "files-found":
    case "root-unreadable":
    case "scan-completed":
    case "listing-failed":
      return null;
  }
};

export const bucketPageReducer: EffectReducer<State, Action, Effect> = (
  state,
  action,
  exec
) => {
  const afterAction = actionReducer(state, action, exec);
  if (afterAction !== null) return afterAction;
  // A message after the listing has settled (a late event, or the browser
  // reporting the closed stream) changes nothing.
  if (state.status !== "listing") return state;
  switch (action.type) {
    case "page-opened":
      // Opened again (Strict Mode remounts): one listener, the newest.
      return listen(state, exec);
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
    case "delete-originals-clicked":
    case "file-action-clicked":
    case "restore-clicked":
    case "empty-trash-clicked":
    case "trash-listed":
    case "trash-list-failed":
    case "reveal-failed":
    case "notice-dismissed":
    case "storage-jobs-observed":
    case "storage-action-planned":
    case "storage-action-confirmed":
    case "storage-action-cancelled":
    case "storage-action-started":
    case "storage-action-failed":
    case "storage-action-dismissed":
      // The action menus' and the Jobs' events, handled above.
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
