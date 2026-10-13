// Entry point (server) for the storage package: moving a Storage Bucket's
// files between Storage Roots (#2109).
//
// `planStorageMove` is the confirmation: what would be copied, the target's
// free space, and every reason the move would not start. `runStorageMove` is
// the `storage-move` Sidecar Job's work: copy, then verify by checksum, file
// by file; never overwrite, never delete an original, and change no row and
// no Export Hash (ADR 0040, ADR 0041). Cancel removes partial copies.
export {
  MOVE_PARTIAL_SUFFIX,
  StorageMoveCancelledError,
  StorageMoveFailedError,
  StorageMoveRefusedError,
  planStorageMove,
  realStorageMoveDisk,
  runStorageMove,
  startStorageMove,
  type StorageMoveDisk,
} from "./lib/move.server";
