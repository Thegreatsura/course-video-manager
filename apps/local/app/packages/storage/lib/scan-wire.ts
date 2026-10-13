import type {
  StorageBucket,
  StorageFileKind,
  StorageFileRole,
} from "./buckets";
import type { VolumeDirtyBit } from "./dirty-bit";

/**
 * Why a move must not go to this root, or null when it may. An Offline root
 * takes no files: it is unplugged or can't be read, so a copy to it can't be
 * written or verified. (A Dirty root is warned about, not refused.)
 */
export const moveTargetRefusal = (target: StorageRootReport): string | null =>
  target.online ? null : `${target.label} is Offline`;

/**
 * What the storage scan streams to the Storage page, one SSE event each,
 * named by its `type`. Sizes are DELTAS: the page adds them up, so rows appear
 * and grow as the walk finds files. Nothing is saved.
 */
export type StorageRootReport =
  | {
      readonly root: string;
      readonly label: string;
      readonly online: true;
      readonly totalBytes: number;
      readonly freeBytes: number;
      /** Windows' dirty bit for the drive: `dirty` warns on the page. */
      readonly dirtyBit: VolumeDirtyBit;
    }
  | {
      readonly root: string;
      readonly label: string;
      readonly online: false;
      readonly reason: string;
    };

export type StorageSizeDelta = {
  readonly bucketId: string;
  /** A Storage Root, or another folder CVM writes to (export scratch). */
  readonly location: string;
  readonly kind: StorageFileKind;
  readonly bytes: number;
  readonly files: number;
};

export type StorageScanMessage =
  | { readonly type: "roots-measured"; readonly roots: StorageRootReport[] }
  | { readonly type: "buckets-listed"; readonly buckets: StorageBucket[] }
  | { readonly type: "sizes-counted"; readonly sizes: StorageSizeDelta[] }
  | {
      readonly type: "root-unreadable";
      readonly root: string;
      readonly message: string;
    }
  | { readonly type: "scan-completed" };

export const STORAGE_SCAN_MESSAGE_TYPES = [
  "roots-measured",
  "buckets-listed",
  "sizes-counted",
  "root-unreadable",
  "scan-completed",
] as const satisfies readonly StorageScanMessage["type"][];

/**
 * One file the per-bucket listing found: a file in the bucket, at one
 * location. A file on two roots (mid-move) is found twice, once per root.
 * `path` is root-relative (or, for export scratch, relative to that folder).
 */
export type StorageFileFound = {
  readonly path: string;
  readonly location: string;
  readonly bytes: number;
  readonly role: StorageFileRole;
  readonly companionOf: string | null;
};

/**
 * What the per-bucket listing streams to the per-bucket page, one SSE event
 * each, named by its `type`. The same walk as the Storage page's scan, kept
 * to one Storage Bucket and reported file by file. Nothing is saved.
 */
export type StorageBucketFilesMessage =
  | { readonly type: "roots-measured"; readonly roots: StorageRootReport[] }
  | { readonly type: "bucket-identified"; readonly bucket: StorageBucket }
  | { readonly type: "files-found"; readonly files: StorageFileFound[] }
  | {
      readonly type: "root-unreadable";
      readonly root: string;
      readonly message: string;
    }
  | { readonly type: "scan-completed" };

export const STORAGE_BUCKET_FILES_MESSAGE_TYPES = [
  "roots-measured",
  "bucket-identified",
  "files-found",
  "root-unreadable",
  "scan-completed",
] as const satisfies readonly StorageBucketFilesMessage["type"][];

/**
 * The only Storage Buckets the Storage page can delete: their files are
 * rebuilt on demand (the Overlay Render Cache, export scratch) or are no
 * Video's current Exported Video. Raw Footage is never deleted outright
 * (Unused Footage goes to the trash first, ADR 0043), and Clip Mockups are
 * only viewed and moved (ADR 0041).
 */
export const DELETABLE_STORAGE_BUCKETS = [
  "overlay-render-cache",
  "export-scratch",
  "orphaned-exports",
] as const satisfies readonly StorageBucket["kind"][];

export type DeletableStorageBucketId =
  (typeof DELETABLE_STORAGE_BUCKETS)[number];

/** Whether the Storage page offers to delete this bucket's files. */
export const bucketCanBeDeleted = (bucket: StorageBucket): boolean =>
  (DELETABLE_STORAGE_BUCKETS as readonly string[]).includes(bucket.kind) &&
  bucket.id === bucket.kind;

/**
 * What deleting a bucket did: files and bytes gone from each location, and
 * each file left (Windows had it open, or it failed a safety check), and why.
 */
export type StorageDeleteResult = {
  readonly bucketId: string;
  readonly deleted: { location: string; files: number; bytes: number }[];
  readonly left: { path: string; location: string; message: string }[];
};
