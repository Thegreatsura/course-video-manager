import type { StorageFileRole } from "./buckets";
import type { StorageFileFound } from "./scan-wire";

/**
 * One file of a Storage Bucket, as the per-bucket page lists it: what it is,
 * and its size on each location it was found on. A file mid-move is on both
 * roots, so it has two copies.
 */
export type StorageBucketFile = {
  readonly path: string;
  readonly role: StorageFileRole;
  readonly companionOf: string | null;
  /** location → bytes. */
  readonly copies: Readonly<Record<string, number>>;
  /** The largest copy's size: what the file takes up on one drive. */
  readonly bytes: number;
};

/** Add files the listing found to those found so far, by path. */
export const addFoundFiles = (
  files: Readonly<Record<string, StorageBucketFile>>,
  found: readonly StorageFileFound[]
): Record<string, StorageBucketFile> => {
  const next = { ...files };
  for (const f of found) {
    const was = next[f.path];
    const copies = { ...was?.copies, [f.location]: f.bytes };
    next[f.path] = {
      path: f.path,
      role: f.role,
      companionOf: f.companionOf,
      copies,
      bytes: Math.max(...Object.values(copies)),
    };
  }
  return next;
};

/**
 * Forget every copy at `location` (a root the walk could not read shows no
 * files, not some); a file with no copy left goes.
 */
export const dropFilesAt = (
  files: Readonly<Record<string, StorageBucketFile>>,
  location: string
): Record<string, StorageBucketFile> => {
  const next: Record<string, StorageBucketFile> = {};
  for (const [key, file] of Object.entries(files)) {
    const { [location]: _dropped, ...copies } = file.copies;
    const sizes = Object.values(copies);
    if (sizes.length === 0) continue;
    next[key] = { ...file, copies, bytes: Math.max(...sizes) };
  }
  return next;
};

/** The bucket's files, largest first (by path when equal). */
export const largestFirst = (
  files: Readonly<Record<string, StorageBucketFile>>
): StorageBucketFile[] =>
  Object.values(files).sort(
    (a, b) => b.bytes - a.bytes || a.path.localeCompare(b.path)
  );
