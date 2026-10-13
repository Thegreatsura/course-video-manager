// Entry point (server) for the storage package: the trash for Unused
// Footage (#2157).
//
// Unused Footage (no Clip, live or archived, uses it; no Recording Session
// still recording or under 7 days old; changed over 7 days ago) is moved to
// `<root>/.cvm-trash/` on its own Storage Root, a rename that never crosses
// drives. Restore puts a file back; trash older than 14 days is deleted for
// good, and "Empty trash" deletes it now. Every path's real location is
// checked, links are never followed, nothing is overwritten, and every
// operation refuses while an export, a Publish, a move, a transcription,
// another delete or a recording is queued or running.
export {
  StorageTrashFailedError,
  StorageTrashRefusedError,
  TRASH_BUSY_JOB_KINDS,
  type RestoreFileRef,
  type TrashFileRef,
} from "./lib/trash-checks.server";
export { trashUnusedFootage } from "./lib/trash.server";
export {
  emptyStorageTrash,
  listStorageTrash,
  restoreTrashedFootage,
  trashHasExpired,
} from "./lib/trash-restore.server";
