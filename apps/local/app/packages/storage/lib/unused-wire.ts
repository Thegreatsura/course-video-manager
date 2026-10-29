/**
 * DELETING UNUSED FOOTAGE (#2157, #2423), what the Storage pages and the
 * server share. Browser-safe.
 *
 * Unused Footage is deleted for good, straight away, after a confirmation:
 * there is no trash (ADR 0043 is superseded). Every check that decides a
 * file is Unused is made again by the server when the delete starts, and by
 * the Sidecar Job just before each file goes.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How old Footage (and a Recording Session no Clip uses) must be before it
 * is ever offered as Unused: a take from this week may not have its Clips yet.
 */
export const UNUSED_FOOTAGE_MIN_AGE_DAYS = 7;
export const UNUSED_FOOTAGE_MIN_AGE_MS = UNUSED_FOOTAGE_MIN_AGE_DAYS * DAY_MS;

/** Why deleting Unused Footage did not start. Nothing was deleted. */
export type StorageUnusedRefusalReason =
  /** An export, Publish, move, transcription or another delete is queued or running. */
  | "storage-job-running"
  /** A Recording Session is writing Footage. */
  | "recording-active"
  /** A Purge, a delete or a move is being started on the Storage page. */
  | "storage-busy";

/**
 * What deleting Unused Footage did, or (`dryRun`) would do: files deleted
 * per Storage Root; files it would not touch and why (`kept`: a Clip uses
 * it, too new; `left`: a check failed, or Windows holds it open).
 */
export type StorageUnusedDeleteResult = {
  readonly dryRun: boolean;
  readonly done: { location: string; files: number; bytes: number }[];
  readonly kept: { path: string; location: string; reason: string }[];
  readonly left: { path: string; location: string; message: string }[];
};

/** Files deleted, every location added up. */
export const unusedDeletedFiles = (result: StorageUnusedDeleteResult) =>
  result.done.reduce((n, d) => n + d.files, 0);
