// Entry point (server) for the storage package: deleting Unused Footage
// (#2157, #2423).
//
// Unused Footage (no Clip, live or archived, uses it; no Recording Session
// still recording or under 7 days old; changed over 7 days ago) is deleted
// for good, after the author's confirmation. There is no trash (ADR 0043 is
// superseded). Every path's real location is checked, links are never
// followed, and every delete refuses while an export, a Publish, a move, a
// transcription, another delete or a recording is queued or running.
export {
  StorageUnusedDeleteFailedError,
  StorageUnusedDeleteRefusedError,
  UNUSED_DELETE_BUSY_JOB_KINDS,
  type UnusedFileRef,
} from "./lib/unused-checks.server";
export { deleteUnusedFootage } from "./lib/unused-delete.server";
