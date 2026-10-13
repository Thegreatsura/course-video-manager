// Entry point (server) for the storage package: the Storage page's scan.
//
// `streamStorageScan` measures each Storage Root (size, free space and
// Windows' dirty bit, or Offline), reads from the database what owns each file, then walks every
// root's CVM folders (and export scratch), streaming per-bucket, per-root,
// per-kind byte totals as it counts. It only reads, and saves nothing.
// Interrupting it — the page closing its SSE stream — stops the walk.
export {
  StorageOwnershipLoadError,
  loadStorageOwnership,
} from "./lib/ownership.server";
export { scanStorageFolders, streamStorageScan } from "./lib/scan.server";
export { windowsDirtyBitReader } from "./lib/dirty-bit.server";
export type { DirtyBitReader } from "./lib/dirty-bit";
