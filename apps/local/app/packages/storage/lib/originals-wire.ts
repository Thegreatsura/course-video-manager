import type { StorageBucketFile } from "./bucket-files";

/**
 * "DELETE ORIGINALS" (#2110), what the per-bucket page and the server share.
 *
 * After a move, a Storage Bucket's files are on two Storage Roots. Deleting
 * the originals deletes the copy on ONE root (`from`, the root Matt picks),
 * file by file, and only where an identical copy (same size, SHA-256 read
 * again from both files just before the delete) is on another root. A file
 * on `from` with no identical copy elsewhere is kept, so the last copy of
 * anything, raw Footage included, is never deleted (ADR 0041).
 */

/** Why "Delete originals" did not start. Nothing was deleted. */
export type StorageOriginalsRefusalReason =
  /** No such bucket, or one whose files are never moved (so have no originals). */
  | "not-deletable"
  /** `from` is not a Storage Root, or there is no other root to hold a copy. */
  | "unknown-root"
  /** `from` can't be read: Offline. */
  | "offline"
  /** `from` and another root are, or may be, the same folder on disk. */
  | "same-root"
  /** `<from>/<folder>` is not really there (a link elsewhere). */
  | "unsafe-folder"
  /** An export, Publish, move, transcription or Clip Mockup voice is queued or running. */
  | "export-running"
  /** A Recording Session is writing Footage. */
  | "recording-active"
  /** A Purge, a delete, a move being started or another "Delete originals". */
  | "storage-busy"
  /** No file on `from` has a same-size copy on another root. */
  | "nothing-to-delete";

/**
 * What "Delete originals" did, or (`dryRun`) would do, on `from`.
 *
 * Deleting runs as a `storage-delete` Sidecar Job (`delete-job-wire.ts`);
 * the dry run answers the confirmation inline, deleting nothing.
 *
 * A dry run reads no file's contents: `deleted` is then every file on `from`
 * with a same-size copy on another root, each of which is checksummed again,
 * against that copy, before it is deleted. The confirmation shows it.
 */
export type StorageOriginalsResult = {
  readonly bucketId: string;
  readonly bucketName: string;
  /** The Storage Root the originals are deleted from. */
  readonly from: string;
  readonly dryRun: boolean;
  /** Deleted (dry run: to be checked, then deleted). */
  readonly deleted: { readonly files: number; readonly bytes: number };
  /** On `from` with no copy of the same size on another root: never deleted. */
  readonly kept: { readonly files: number; readonly bytes: number };
  /**
   * Checked and NOT deleted, and why: a checksum mismatch, a file Windows
   * holds open, a link, a check that failed. Each is still on `from`; retry.
   */
  readonly left: readonly { readonly path: string; readonly message: string }[];
};

/**
 * The files on `location` that have a copy of the same size on another
 * location the listing found: what "Delete originals on <location>" would
 * offer to delete, before the server checks each one again.
 */
export const originalsAt = (
  files: Readonly<Record<string, StorageBucketFile>>,
  location: string
): { files: number; bytes: number } => {
  let count = 0;
  let bytes = 0;
  for (const file of Object.values(files)) {
    const here = file.copies[location];
    if (here === undefined) continue;
    const elsewhere = Object.entries(file.copies).some(
      ([at, size]) => at !== location && size === here
    );
    if (!elsewhere) continue;
    count += 1;
    bytes += here;
  }
  return { files: count, bytes };
};
