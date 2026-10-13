import type { StorageBucket, StorageFileKind } from "./buckets";

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
