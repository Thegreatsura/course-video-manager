// Entry point (server) for the storage package: Purging a Storage Bucket's
// Exported Videos (#2111).
//
// Only a Course's, Standalone Videos' and Shorts' Exported Videos (and their
// companions) can be Purged, and only for Videos whose Footage is all found
// on a reachable Storage Root, so every one deleted can be exported again.
// The others are kept and reported as skipped. Raw Footage, Recording
// Sessions, Clip Mockups, Video Files and thumbnails are never touched (ADR
// 0041). Refused while an export, a Publish or a Storage move is queued or
// running, or a move is being started. Every
// file's real path is checked inside its root's real `finished-videos/`, and
// outside every root's `raw-footage/`, before it is deleted.
export {
  StoragePurgeFailedError,
  StoragePurgeRefusedError,
  purgeExportedVideos,
} from "./lib/purge-exports.server";
