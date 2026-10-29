// Entry point (server) for the storage package: "Delete originals" (#2110).
//
// After a move, delete a Storage Bucket's files on one Storage Root that have
// an identical copy (same size, SHA-256 read again from both just before the
// delete) on another root. The only way CVM ever deletes raw Footage, and
// only as a duplicate: a file with no identical copy elsewhere is kept, so the
// last copy is never deleted (ADR 0041). Always Matt's click, never automatic.
//
// `planStorageOriginals` is the confirmation (a count; deletes nothing).
// `startDeleteOriginals` checks the refusals that need no drive and enqueues
// the `storage-delete` Sidecar Job; `runDeleteOriginals` is that Job's work.
// Refused while an export, a Publish, a move, another delete, a
// transcription, a Clip Mockup voice or a Recording Session is queued or
// running, or a Purge, a delete or a move is being started; looked for again
// before each file. Files Windows holds open are left and reported.
export {
  ORIGINALS_BUSY_JOB_KINDS,
  StorageOriginalsCancelledError,
  StorageOriginalsFailedError,
  StorageOriginalsRefusedError,
  planStorageOriginals,
  realStorageOriginalsDisk,
  runDeleteOriginals,
  startDeleteOriginals,
  type StorageOriginalsDisk,
} from "./lib/originals.server";
