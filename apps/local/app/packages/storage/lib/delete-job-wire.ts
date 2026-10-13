/**
 * THE STORAGE DELETE JOB (#2110): every delete on the Storage page runs as one
 * `storage-delete` Sidecar Job, never inline in a request. Browser-safe.
 *
 * One kind, many operations. A Job's params name its `operation` and what it
 * needs; today only "Delete originals" (`originals`). The Purge of Exported
 * Videos (#2111) and the delete of an Other bucket (#2112) become operations
 * here too: add a member to `STORAGE_DELETE_OPERATIONS`, its params to the
 * Job's params union (`sidecar/job-params.ts`), and a branch in
 * `sidecar/kinds/storage-delete.ts`. Each reports the same
 * `StorageDeleteJobResult`, so the Upload Manager row, the toasts and the
 * "N files still on D:, retry" line work for all of them unchanged.
 *
 * The rules every operation keeps:
 * - It is started from a confirmation (a dry run gave the count and GB),
 *   checking every refusal while holding the Storage page's write hold, then
 *   enqueued. The Job checks every refusal again when it runs.
 * - While a `storage-delete` Job is queued or running, a move, a Purge, a
 *   delete and another `storage-delete` refuse (`STORAGE_BUSY_JOB_KINDS`).
 * - One file at a time; each result recorded (logged, and counted in the
 *   result). A file that can't be deleted is left and reported, and the rest
 *   carry on. The Job then FAILS with "N deleted; N files still on D:,
 *   retry", so its row says so and Retry runs it again.
 * - Cancel stops before the next file. What was deleted stays deleted.
 */

export const STORAGE_DELETE_JOB_KIND = "storage-delete";

/**
 * What a `storage-delete` Job deletes (#2110, #2157):
 * - `originals`: a bucket's files on one root with an identical copy elsewhere;
 * - `purge-exports`: a bucket's Exported Videos whose Footage is all found;
 * - `delete-bucket`: an Other bucket's files (renders, scratch, orphaned exports);
 * - `trash-unused`: Unused Footage, into the Trash on its own drive;
 * - `restore-trash`: trashed files, back where they were;
 * - `empty-trash`: everything in the Trash, for good;
 * - `expire-trash`: Trash older than 14 days, for good (the Sidecar's sweep).
 */
export const STORAGE_DELETE_OPERATIONS = [
  "originals",
  "purge-exports",
  "delete-bucket",
  "trash-unused",
  "restore-trash",
  "empty-trash",
  "expire-trash",
] as const;
export type StorageDeleteOperation = (typeof STORAGE_DELETE_OPERATIONS)[number];

/** Checking (refusals, then each file against its copy), then deleting. */
export const STORAGE_DELETE_STAGES = ["checking", "deleting"] as const;
export type StorageDeleteStage = (typeof STORAGE_DELETE_STAGES)[number];
export const isStorageDeleteStage = (
  stage: string
): stage is StorageDeleteStage =>
  (STORAGE_DELETE_STAGES as readonly string[]).includes(stage);

/** The Job finished (or stopped part-way): its result, as a Job Event. */
export const STORAGE_DELETED_EVENT = "storage-deleted";

/** What any `storage-delete` Job did. */
export type StorageDeleteJobResult = {
  readonly bucketId: string;
  readonly operation: StorageDeleteOperation;
  /** Where it deleted from (`originals`: the one Storage Root), if one place. */
  readonly location: string | null;
  readonly deleted: { readonly files: number; readonly bytes: number };
  /** Never candidates (`originals`: no identical copy elsewhere). */
  readonly kept: { readonly files: number; readonly bytes: number };
  /** Checked and not deleted, and why: still where they were. Retry. */
  readonly left: readonly { readonly path: string; readonly message: string }[];
};

/** One file's name, or "3 files": what a per-file Job's title names. */
const whichFiles = (paths: readonly string[] | undefined, what: string) =>
  paths === undefined || paths.length === 0
    ? null
    : paths.length === 1
      ? paths[0]!.split("/").pop()!
      : `${paths.length} ${what}`;

/**
 * The Job's title: "Delete Crash Course originals on D:", "Delete Crash
 * Course Exported Videos", "Move 12 Unused Footage files to the Trash".
 */
export const storageDeleteTitle = (opts: {
  readonly operation: StorageDeleteOperation;
  readonly bucketName: string;
  readonly locationLabel: string;
  /** A per-file Job's files (root-relative). */
  readonly paths?: readonly string[];
}) => {
  const one = whichFiles(opts.paths, "files");
  switch (opts.operation) {
    case "originals":
      return one === null
        ? `Delete ${opts.bucketName} originals on ${opts.locationLabel}`
        : `Delete the original of ${one} on ${opts.locationLabel}`;
    case "purge-exports":
      return one === null
        ? `Delete ${opts.bucketName} Exported Videos`
        : `Delete Exported Video ${one}`;
    case "delete-bucket":
      return one === null
        ? `Delete ${opts.bucketName}`
        : `Delete ${one} (${opts.bucketName})`;
    case "trash-unused":
      return one === null
        ? "Move Unused Footage to the Trash"
        : `Move ${one} to the Trash`;
    case "restore-trash":
      return `Restore ${one ?? "files"} from the Trash`;
    case "empty-trash":
      return "Empty the Trash";
    case "expire-trash":
      return "Delete Trash older than 14 days";
  }
};

const gbOrMb = (bytes: number) =>
  bytes >= 1024 ** 3
    ? `${(bytes / 1024 ** 3).toFixed(1)} GB`
    : `${(bytes / 1024 ** 2).toFixed(1)} MB`;

/**
 * The result in one line: "2 deleted (5.0 GB); 1 file still on D:, retry".
 * `label` names the location ("D:").
 */
export const storageDeleteSummary = (
  result: Pick<StorageDeleteJobResult, "deleted" | "kept" | "left"> & {
    readonly operation?: StorageDeleteOperation;
  },
  label: string
) => {
  const verb =
    result.operation === "trash-unused"
      ? "moved to the Trash"
      : result.operation === "restore-trash"
        ? "restored"
        : "deleted";
  const parts = [
    `${result.deleted.files} ${verb} (${gbOrMb(result.deleted.bytes)})`,
  ];
  if (result.left.length > 0) {
    parts.push(
      `${result.left.length} ${result.left.length === 1 ? "file" : "files"} still on ${label}, retry`
    );
  }
  if (result.kept.files > 0) {
    parts.push(
      `${result.kept.files} ${result.operation === "originals" ? "with no copy elsewhere" : "kept"} ${result.kept.files === 1 ? "stays" : "stay"}`
    );
  }
  return parts.join("; ");
};
