// Entry point (server) for the storage package: deleting an Other Storage
// Bucket's files (#2112).
//
// Only the Overlay Render Cache, export scratch and the Exported Videos of no
// current Video can be deleted; every other bucket is refused, and raw
// Footage never can be (ADR 0041). Refused while an export or a Storage move
// runs (or a move is being started); orphaned
// exports are refused until the Export Hash rename has been recorded. Every
// file's real path is checked inside its bucket's real folder, and outside
// every root's `raw-footage/`, before it is deleted.
export { StorageDeleteCancelledError } from "./lib/delete-safety.server";
export {
  StorageDeleteFailedError,
  StorageDeleteRefusedError,
  deleteOtherStorageBucket,
} from "./lib/delete-other.server";
export {
  StorageDeleteStartRefusedError,
  startStorageDelete,
} from "./lib/delete-start.server";
