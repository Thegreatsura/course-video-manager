// Entry point (pure) for the storage package: Storage Buckets and the scan's
// wire format.
//
// A Storage Bucket is the unit the Storage page counts space in: each Course,
// Standalone Videos, Shorts, Shared Footage (Footage Clips in more than one Course
// use), Unused Footage (Footage under `raw-footage/` no Clip and no
// Recording Session uses), and the Other buckets (Clip Mockups, the Overlay
// Render Cache, export scratch, Exported Videos of no current Video). The scan streams
// `StorageScanMessage`s; the page adds them up. Running the scan is
// `./scan.ts`.
export {
  assignStorageBuckets,
  classifyStorageFile,
  courseBucketId,
  type StorageBucket,
  type StorageBucketKind,
  type StorageFileKind,
  type StorageOwnership,
  type StorageOwnershipInput,
} from "./lib/buckets";
export {
  windowsDriveOf,
  parseDirtyQueryOutput,
  type VolumeDirtyBit,
} from "./lib/dirty-bit";
export {
  STORAGE_SCAN_MESSAGE_TYPES,
  moveTargetRefusal,
  type StorageRootReport,
  type StorageScanMessage,
  type StorageSizeDelta,
} from "./lib/scan-wire";
