/**
 * THE TRASH (#2157), what the Storage pages and the server share.
 * Browser-safe.
 *
 * Unused Footage is never deleted straight away. Moving it to the trash
 * renames each file into `<root>/.cvm-trash/<batch>/<its root-relative
 * path>` on the SAME Storage Root (a rename, never a copy, so it never
 * crosses drives). A trashed file can be put back (Restore) until it is 14
 * days old in the trash; then it is deleted for good. "Empty trash" deletes
 * it all now.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** The trash folder at the top of each Storage Root. */
export const TRASH_FOLDER = ".cvm-trash";

/** How long a trashed file is kept before it is deleted for good. */
export const TRASH_RETENTION_DAYS = 14;
export const TRASH_RETENTION_MS = TRASH_RETENTION_DAYS * DAY_MS;

/**
 * How old Footage (and a Recording Session no Clip uses) must be before it
 * is ever offered as Unused: a take from this week may not have its Clips yet.
 */
export const UNUSED_FOOTAGE_MIN_AGE_DAYS = 7;
export const UNUSED_FOOTAGE_MIN_AGE_MS = UNUSED_FOOTAGE_MIN_AGE_DAYS * DAY_MS;

/**
 * A trash batch's folder name: when it was trashed, then something unique
 * (`20261013T120000Z-1a2b3c4d`). Its age is read from the name, never from a
 * file's times (a rename keeps the file's own).
 */
const BATCH_PATTERN =
  /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z-[A-Za-z0-9-]{1,64}$/;

export const trashBatchName = (trashedAt: Date, unique: string) =>
  `${trashedAt
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(
      /\.\d{3}Z$/,
      "Z"
    )}-${unique.replace(/[^A-Za-z0-9-]/g, "").slice(0, 64) || "batch"}`;

/** When a batch was trashed, from its folder name; null for a name not ours. */
export const trashedAtOf = (batch: string): Date | null => {
  const m = BATCH_PATTERN.exec(batch);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  const at = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}Z`);
  return Number.isNaN(at.getTime()) ? null : at;
};

/** When a batch trashed at `trashedAt` is deleted for good. */
export const trashExpiresAt = (trashedAt: Date) =>
  new Date(trashedAt.getTime() + TRASH_RETENTION_MS);

/** One trashed file: where it is, and where Restore puts it back. */
export type StorageTrashEntry = {
  /** The Storage Root it is on (and goes back to). */
  readonly location: string;
  readonly batch: string;
  /** Root-relative: where it was, and where Restore puts it (`raw-footage/…`). */
  readonly path: string;
  readonly bytes: number;
  /** ISO. */
  readonly trashedAt: string;
  /** ISO: deleted for good after this. */
  readonly expiresAt: string;
};

/** Why a trash operation did not start. Nothing was moved or deleted. */
export type StorageTrashRefusalReason =
  /** An export, Publish, move, transcription or another delete is queued or running. */
  | "storage-job-running"
  /** A Recording Session is writing Footage. */
  | "recording-active"
  /** A Purge, a delete or a move is being started on the Storage page. */
  | "storage-busy";

export type StorageTrashOperation = "trash" | "restore" | "empty" | "expire";

/**
 * What a trash operation did, or (`dryRun`) would do: files moved to the
 * trash, put back, or deleted for good, per Storage Root; files it would not
 * touch and why (`kept`: a Clip uses it, too new; `left`: a check failed, or
 * Windows holds it open).
 */
export type StorageTrashResult = {
  readonly operation: StorageTrashOperation;
  readonly dryRun: boolean;
  /** The trash batch the files went into (`trash` only). */
  readonly batch: string | null;
  readonly done: { location: string; files: number; bytes: number }[];
  readonly kept: { path: string; location: string; reason: string }[];
  readonly left: { path: string; location: string; message: string }[];
};

/** Files a trash operation moved or deleted, every location added up. */
export const trashDoneFiles = (result: StorageTrashResult) =>
  result.done.reduce((n, d) => n + d.files, 0);

/** Bytes a trash operation moved or deleted, every location added up. */
export const trashDoneBytes = (result: StorageTrashResult) =>
  result.done.reduce((n, d) => n + d.bytes, 0);
