import type { storageAction } from "./storage-action";
import { kindOfRole, type RemovedBytes } from "./storage-cache";
import type { bucketPageReducer } from "./bucket-page-reducer";
import {
  bucketCanBeDeleted,
  bucketCanBePurged,
  movableKindsOf,
  type StorageBucket,
  type StorageBucketFile,
  type StorageMoveKind,
} from "@/packages/storage/client";

/**
 * THE PER-BUCKET PAGE'S FILES (#2157, #2423): what each file's menu offers,
 * the one request a delete of some files makes, and the copies that delete
 * takes, from what the page has listed. Pure; `bucket-page-reducer.ts`
 * decides with them.
 */

type State = bucketPageReducer.State;
type RemovedCopy = bucketPageReducer.RemovedCopy;

const UNUSED_FOOTAGE = "unused-footage";

/** The Delete a file's menu offers, by its bucket, or null. */
const deleteLabelOf = (
  bucket: StorageBucket,
  file: StorageBucketFile
): string | null =>
  bucket.kind === UNUSED_FOOTAGE
    ? "Delete"
    : bucketCanBePurged(bucket) && file.role === "exported-video"
      ? "Delete Exported Video"
      : bucketCanBeDeleted(bucket) && file.role !== "export-companion"
        ? "Delete"
        : null;

/** Whether the file can be ticked: it has a Delete. */
export const fileCanBeTicked = (state: State, path: string): boolean => {
  const file = state.files[path];
  return (
    state.bucket !== null &&
    file !== undefined &&
    deleteLabelOf(state.bucket, file) !== null
  );
};

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
    case "move-partial":
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
  const deletable = deleteLabelOf(bucket, file);
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

export const sameChoice = (
  a: bucketPageReducer.FileChoice,
  b: bucketPageReducer.FileChoice
) => JSON.stringify(a) === JSON.stringify(b);

/** Every copy of a file, as the server names a file on a drive. */
const copiesOf = (file: StorageBucketFile): storageAction.FileAt[] =>
  Object.keys(file.copies).map((location) => ({ location, path: file.path }));

/** The one delete request for these files, by what the bucket allows. */
export const deleteRequest = (
  bucket: StorageBucket,
  files: readonly StorageBucketFile[]
): storageAction.Request | null => {
  if (files.length === 0) return null;
  if (bucket.kind === UNUSED_FOOTAGE) {
    return { type: "delete-unused", files: files.flatMap(copiesOf) };
  }
  if (bucketCanBePurged(bucket)) {
    return { type: "purge", bucket, exportPaths: files.map((f) => f.path) };
  }
  return { type: "delete-bucket", bucket, files: files.flatMap(copiesOf) };
};

/** The request a file's chosen action makes. */
export const fileRequest = (
  bucket: StorageBucket,
  file: StorageBucketFile,
  choice: Exclude<bucketPageReducer.FileChoice, { type: "reveal" }>
): storageAction.Request | null => {
  switch (choice.type) {
    case "delete":
      return deleteRequest(bucket, [file]);
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

const copyOf = (
  file: StorageBucketFile,
  location: string
): RemovedCopy | null => {
  const bytes = file.copies[location];
  return bytes === undefined
    ? null
    : { location, path: file.path, bytes, file };
};

const allCopies = (file: StorageBucketFile): RemovedCopy[] =>
  Object.keys(file.copies).flatMap((l) => copyOf(file, l) ?? []);

/**
 * Every copy a delete request takes, from what the page has listed: the
 * confirmation's count and size, and what the page forgets once the Job
 * reports it took exactly these (#2423). The server decides again.
 */
export const copiesDeleted = (
  state: State,
  request: storageAction.Request
): RemovedCopy[] => {
  const files = Object.values(state.files);
  switch (request.type) {
    case "move":
      return [];
    case "delete-unused":
    case "delete-bucket":
      return (request.files ?? []).flatMap((f) => {
        const file = state.files[f.path];
        return file === undefined ? [] : (copyOf(file, f.location) ?? []);
      });
    case "purge": {
      // An Exported Video goes with its companions, on every drive.
      const exports = new Set(request.exportPaths ?? []);
      return files
        .filter(
          (f) =>
            exports.has(f.path) ||
            (f.companionOf !== null && exports.has(f.companionOf))
        )
        .flatMap(allCopies);
    }
    case "originals": {
      const only = request.paths === null ? null : new Set(request.paths);
      return files.flatMap((f) => {
        if (only !== null && !only.has(f.companionOf ?? f.path)) return [];
        const here = f.copies[request.from];
        if (here === undefined) return [];
        const elsewhere = Object.entries(f.copies).some(
          ([at, size]) => at !== request.from && size === here
        );
        return elsewhere ? (copyOf(f, request.from) ?? []) : [];
      });
    }
  }
};

/** The confirmation's numbers, per location. */
export const deletePlanOf = (
  copies: readonly RemovedCopy[]
): storageAction.DeletePlan => {
  const byLocation = new Map<string, { files: number; bytes: number }>();
  for (const c of copies) {
    const was = byLocation.get(c.location) ?? { files: 0, bytes: 0 };
    byLocation.set(c.location, {
      files: was.files + 1,
      bytes: was.bytes + c.bytes,
    });
  }
  return {
    type: "delete",
    byLocation: [...byLocation].map(([location, t]) => ({ location, ...t })),
  };
};

/** The list without the copies a delete took. */
export const withoutCopies = (
  files: Readonly<Record<string, StorageBucketFile>>,
  removed: readonly RemovedCopy[]
): Record<string, StorageBucketFile> => {
  const next = { ...files };
  for (const r of removed) {
    const file = next[r.path];
    if (file === undefined) continue;
    const { [r.location]: _gone, ...copies } = file.copies;
    const sizes = Object.values(copies);
    if (sizes.length === 0) delete next[r.path];
    else next[r.path] = { ...file, copies, bytes: Math.max(...sizes) };
  }
  return next;
};

/** What the Storage page's totals lose, per location and kind. */
export const removedBytesOf = (
  removed: readonly RemovedCopy[]
): RemovedBytes[] => {
  const out = new Map<string, RemovedBytes>();
  for (const r of removed) {
    const kind = kindOfRole(r.file.role);
    const key = `${r.location}\0${kind}`;
    const was = out.get(key) ?? {
      location: r.location,
      kind,
      bytes: 0,
      files: 0,
    };
    out.set(key, { ...was, bytes: was.bytes + r.bytes, files: was.files + 1 });
  }
  return [...out.values()];
};
