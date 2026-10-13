// Entry point (public, browser-safe) for the storage package: the scan's wire
// format, for the Storage page.
//
// WHY A SECOND ENTRY POINT. `buckets.ts` re-exports `lib/buckets`, which
// classifies files by path with `node:path` (and reaches `lib/storage-roots`,
// which does too). That is right on the server and cannot run in a browser —
// so the Storage page importing `STORAGE_SCAN_MESSAGE_TYPES` from `buckets.ts`
// pulled `node:path` into the client bundle and failed the production build.
// Same split as `course-json/client.ts`.
//
// Everything here comes from `lib/scan-wire`, whose only imports are
// type-only (erased), plus the bucket TYPES the messages carry. Import THIS from a
// component, a hook, or a route's default export; import `buckets.ts` from a
// loader, a service or the scan.
export type {
  StorageBucket,
  StorageBucketKind,
  StorageFileKind,
} from "./lib/buckets";
export {
  STORAGE_SCAN_MESSAGE_TYPES,
  moveTargetRefusal,
  type StorageRootReport,
  type StorageScanMessage,
  type StorageSizeDelta,
} from "./lib/scan-wire";
