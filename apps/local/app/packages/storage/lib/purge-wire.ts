import type { StorageBucket } from "./buckets";

/**
 * The Storage Buckets whose Exported Videos can be Purged (#2111): each
 * Course, Standalone Videos and Shorts (uploaded Shorts included). Shared
 * and Unused Footage hold no Exported Videos; the Exported Videos of no
 * current Video are #2112's Other bucket. Raw Footage is never deletable
 * (ADR 0041).
 */
export const PURGEABLE_STORAGE_BUCKET_KINDS = [
  "course",
  "standalone-videos",
  "shorts",
] as const satisfies readonly StorageBucket["kind"][];

/** Whether the Storage page offers to Purge this bucket's Exported Videos. */
export const bucketCanBePurged = (bucket: StorageBucket): boolean =>
  (PURGEABLE_STORAGE_BUCKET_KINDS as readonly string[]).includes(bucket.kind);

/**
 * A Video whose Exported Videos were kept: some of its Footage is on no
 * reachable Storage Root ("Footage not found (E: offline?): raw-footage/…"),
 * or it has no Clips, so it could not be exported again.
 */
export type StoragePurgeSkippedVideo = {
  readonly videoId: string;
  readonly title: string;
  readonly reason: string;
  /** Bytes of its Exported Videos (and companions) kept, on every root. */
  readonly bytes: number;
};

/**
 * What a Purge did, or (`dryRun`) would do: the Exported Videos (and
 * companions) deleted from each location, the Videos they belonged to, the
 * Videos skipped and why, and each file left (a safety check failed, or
 * Windows has it open). A planned Purge deletes nothing; it is what the
 * confirmation shows.
 */
export type StoragePurgeResult = {
  readonly bucketId: string;
  readonly dryRun: boolean;
  /** The Videos whose Exported Videos were (or would be) deleted. */
  readonly videos: number;
  readonly deleted: { location: string; files: number; bytes: number }[];
  readonly skipped: StoragePurgeSkippedVideo[];
  readonly left: { path: string; location: string; message: string }[];
};

/** Bytes a Purge deleted (or would delete), every location added up. */
export const purgedBytes = (result: StoragePurgeResult) =>
  result.deleted.reduce((n, d) => n + d.bytes, 0);

/** Files a Purge deleted (or would delete), every location added up. */
export const purgedFiles = (result: StoragePurgeResult) =>
  result.deleted.reduce((n, d) => n + d.files, 0);
