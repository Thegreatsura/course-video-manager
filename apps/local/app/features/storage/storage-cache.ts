import type {
  StorageBucket,
  StorageBucketFile,
  StorageFileKind,
  StorageFileRole,
  StorageRootReport,
} from "@/packages/storage/client";

/**
 * THE STORAGE CACHE (#2423): what the Storage page's scan and each Storage
 * Bucket's listing last found, kept in memory while the app is open (no
 * local storage, nothing on the server). Walking the drives takes seconds
 * per visit, so the pages show what is here and decide when to walk again.
 *
 * The rules are the pages' reducers' (`storage-page-reducer.ts`,
 * `bucket-page-reducer.ts`), with the time on the event:
 * - The view being looked at never refetches on its own (no polling, no
 *   timer): that would shift the layout under the author.
 * - Opening a page, or the window coming back into focus, refetches only
 *   data older than `STORAGE_CACHE_TTL_MS`. Refresh refetches at once.
 * - A delete removes what it deleted from here, instead of walking again.
 *
 * The store is module state: the pages hold it across navigation. Only the
 * effect runners (`use-storage-page.ts`, `use-bucket-page.ts`) touch it.
 */

/** How long a scan or listing is shown before a refocus or a visit walks again. */
export const STORAGE_CACHE_TTL_MS = 5 * 60 * 1000;

/** Whether data fetched at `fetchedAt` is due a walk on a refocus or a visit. */
export const isStale = (fetchedAt: number | null, now: number): boolean =>
  fetchedAt === null || now - fetchedAt >= STORAGE_CACHE_TTL_MS;

/** Bytes (or files) per kind, at one location. */
export type KindBytes = Record<StorageFileKind, number>;

export const NO_BYTES: KindBytes = {
  footage: 0,
  "exported-videos": 0,
  other: 0,
};

/** The Storage page's last complete scan. */
export type CachedScan = {
  readonly fetchedAt: number;
  readonly roots: StorageRootReport[] | null;
  readonly buckets: Record<string, StorageBucket>;
  /** bucket id → location → bytes per kind. */
  readonly totals: Record<string, Record<string, KindBytes>>;
  /** bucket id → location → files per kind. */
  readonly counts: Record<string, Record<string, KindBytes>>;
  readonly unreadableRoots: Record<string, string>;
};

/** One Storage Bucket's last complete listing. */
export type CachedListing = {
  readonly fetchedAt: number;
  readonly roots: StorageRootReport[] | null;
  readonly bucket: StorageBucket | null;
  readonly files: Record<string, StorageBucketFile>;
  readonly unreadableRoots: Record<string, string>;
};

/** What a delete took off one location of one kind: the scan forgets it. */
export type RemovedBytes = {
  readonly location: string;
  readonly kind: StorageFileKind;
  readonly bytes: number;
  readonly files: number;
};

/** Which column of the Storage page a file of this role is counted in. */
export const kindOfRole = (role: StorageFileRole): StorageFileKind => {
  switch (role) {
    case "footage":
    case "recording-session":
    case "footage-companion":
      return "footage";
    case "exported-video":
    case "export-companion":
      return "exported-videos";
    case "clip-mockup":
    case "overlay-render":
    case "export-scratch":
    case "move-partial":
      return "other";
  }
};

const subtract = (
  table: Record<string, Record<string, KindBytes>>,
  bucketId: string,
  removed: readonly RemovedBytes[],
  amount: (r: RemovedBytes) => number
) => {
  const byLocation = { ...table[bucketId] };
  for (const r of removed) {
    const was = byLocation[r.location] ?? NO_BYTES;
    byLocation[r.location] = {
      ...was,
      [r.kind]: Math.max(0, was[r.kind] - amount(r)),
    };
  }
  return { ...table, [bucketId]: byLocation };
};

/** The scan, less what a delete took from one bucket. */
export const scanWithout = (
  scan: CachedScan,
  bucketId: string,
  removed: readonly RemovedBytes[]
): CachedScan => ({
  ...scan,
  totals: subtract(scan.totals, bucketId, removed, (r) => r.bytes),
  counts: subtract(scan.counts, bucketId, removed, (r) => r.files),
});

const store: {
  scan: CachedScan | null;
  listings: Map<string, CachedListing>;
} = { scan: null, listings: new Map() };

/** The store the effect runners read and write. */
export const storageCache = {
  scan: (): CachedScan | null => store.scan,
  listing: (bucketId: string): CachedListing | null =>
    store.listings.get(bucketId) ?? null,
  saveScan: (scan: CachedScan) => {
    store.scan = scan;
  },
  saveListing: (bucketId: string, listing: CachedListing) => {
    store.listings.set(bucketId, listing);
  },
  /** A delete on a bucket's page: the Storage page's totals lose it too. */
  forgetFromScan: (bucketId: string, removed: readonly RemovedBytes[]) => {
    if (store.scan !== null) {
      store.scan = scanWithout(store.scan, bucketId, removed);
    }
  },
  /** Walk again on the next visit: a move changed what is where. */
  forgetScan: () => {
    store.scan = null;
  },
  forgetListing: (bucketId: string) => {
    store.listings.delete(bucketId);
  },
};
