import path from "node:path";
import { rootRelativePath, STORAGE_FOLDERS } from "./storage-roots";

/**
 * A Storage Bucket: the unit the Storage page counts (and later moves) space
 * in. Each Course; Standalone Videos; Shorts; Shared Footage (Footage used by
 * more than one bucket's Clips, listing the Courses that use it); Unused
 * Footage (Footage under `raw-footage/` no Clip and no Recording Session uses);
 * and the Other buckets.
 */
export type StorageBucketKind =
  | "course"
  | "standalone-videos"
  | "shorts"
  | "shared-footage"
  | "unused-footage"
  | "clip-mockups"
  | "overlay-render-cache"
  | "export-scratch"
  | "orphaned-exports";

export type StorageBucket = {
  readonly id: string;
  readonly kind: StorageBucketKind;
  readonly name: string;
  /** Shared Footage only: the names of the buckets whose Clips share it. */
  readonly sharedBy?: readonly string[];
};

/** What a counted file is, inside its bucket. */
export type StorageFileKind = "footage" | "exported-videos" | "other";

export const STANDALONE_VIDEOS_BUCKET: StorageBucket = {
  id: "standalone-videos",
  kind: "standalone-videos",
  name: "Standalone Videos",
};
export const SHORTS_BUCKET: StorageBucket = {
  id: "shorts",
  kind: "shorts",
  name: "Shorts",
};
export const UNUSED_FOOTAGE_BUCKET: StorageBucket = {
  id: "unused-footage",
  kind: "unused-footage",
  name: "Unused Footage",
};
export const CLIP_MOCKUPS_BUCKET: StorageBucket = {
  id: "clip-mockups",
  kind: "clip-mockups",
  name: "Clip Mockups",
};
export const OVERLAY_RENDER_CACHE_BUCKET: StorageBucket = {
  id: "overlay-render-cache",
  kind: "overlay-render-cache",
  name: "Overlay Render Cache",
};
export const EXPORT_SCRATCH_BUCKET: StorageBucket = {
  id: "export-scratch",
  kind: "export-scratch",
  name: "Export scratch",
};
export const ORPHANED_EXPORTS_BUCKET: StorageBucket = {
  id: "orphaned-exports",
  kind: "orphaned-exports",
  name: "Orphaned exports",
};
const SHARED_FOOTAGE_ID = "shared-footage";

export const courseBucketId = (courseId: string) => `course:${courseId}`;

/** What the database says owns which file. Built by `loadStorageOwnership`. */
export type StorageOwnershipInput = {
  readonly courses: readonly { id: string; name: string }[];
  readonly videos: readonly {
    id: string;
    courseId: string | null;
    format: string;
    /** The names in `finished-videos/` that are this Video's export. */
    exportNames: readonly string[];
  }[];
  /** Every stored Footage path a Clip or Recording Session of a Video uses. */
  readonly footageUses: readonly { stored: string; videoId: string | null }[];
};

export type StorageOwnership = {
  readonly buckets: readonly StorageBucket[];
  /** Root-relative Footage path → bucket id. */
  readonly footage: ReadonlyMap<string, string>;
  /** Export file name (no companion suffix) → bucket id. */
  readonly exports: ReadonlyMap<string, string>;
};

/**
 * Assign every used Footage file and every current Exported Video to its
 * Storage Bucket. Footage whose users fall in more than one bucket goes to the
 * single Shared Footage bucket, so it is counted once and never moved out from
 * under another Course.
 */
export const assignStorageBuckets = (
  input: StorageOwnershipInput,
  roots: readonly string[]
): StorageOwnership => {
  const courseBuckets = new Map<string, StorageBucket>(
    input.courses.map((c) => [
      c.id,
      { id: courseBucketId(c.id), kind: "course", name: c.name },
    ])
  );
  const bucketOfVideo = new Map<string, StorageBucket>();
  for (const video of input.videos) {
    const bucket =
      (video.courseId !== null ? courseBuckets.get(video.courseId) : null) ??
      (video.format === "short" ? SHORTS_BUCKET : STANDALONE_VIDEOS_BUCKET);
    bucketOfVideo.set(video.id, bucket);
  }

  const exports = new Map<string, string>();
  for (const video of input.videos) {
    const bucket = bucketOfVideo.get(video.id)!;
    for (const name of video.exportNames) {
      if (!exports.has(name)) exports.set(name, bucket.id);
    }
  }

  const users = new Map<string, Set<StorageBucket>>();
  for (const use of input.footageUses) {
    const relative = rootRelativePath(use.stored, roots);
    if (relative === null) continue;
    const bucket =
      (use.videoId !== null ? bucketOfVideo.get(use.videoId) : undefined) ??
      STANDALONE_VIDEOS_BUCKET;
    const set = users.get(relative) ?? new Set<StorageBucket>();
    set.add(bucket);
    users.set(relative, set);
  }

  const footage = new Map<string, string>();
  const sharers = new Map<string, StorageBucket>();
  for (const [relative, set] of users) {
    if (set.size === 1) {
      footage.set(relative, [...set][0]!.id);
      continue;
    }
    footage.set(relative, SHARED_FOOTAGE_ID);
    for (const bucket of set) sharers.set(bucket.id, bucket);
  }

  const sharedBy = [...sharers.values()]
    .map((b) => b.name)
    .sort((a, b) => a.localeCompare(b));
  return {
    buckets: [
      ...courseBuckets.values(),
      STANDALONE_VIDEOS_BUCKET,
      SHORTS_BUCKET,
      {
        id: SHARED_FOOTAGE_ID,
        kind: "shared-footage",
        name: "Shared Footage",
        sharedBy,
      },
      UNUSED_FOOTAGE_BUCKET,
      CLIP_MOCKUPS_BUCKET,
      OVERLAY_RENDER_CACHE_BUCKET,
      EXPORT_SCRATCH_BUCKET,
      ORPHANED_EXPORTS_BUCKET,
    ],
    footage,
    exports,
  };
};

/**
 * The Footage a file under `raw-footage/` belongs with: itself, or — for a
 * transcript or Whisper piece kept beside it (`a.mkv.transcript.json`) — the
 * longest used Footage path it extends.
 */
const footageBucket = (ownership: StorageOwnership, relative: string) => {
  const exact = ownership.footage.get(relative);
  if (exact !== undefined) return exact;
  for (let i = relative.length - 1; i > 0; i--) {
    const ch = relative[i];
    if (ch !== "." && ch !== "/") continue;
    const owner = ownership.footage.get(relative.slice(0, i));
    if (owner !== undefined) return owner;
  }
  return UNUSED_FOOTAGE_BUCKET.id;
};

/** `x.mp4.sha256` and other companions are counted with `x.mp4`. */
const exportName = (file: string) => {
  const at = file.indexOf(".mp4");
  return at === -1 ? file : file.slice(0, at + ".mp4".length);
};

/**
 * Which bucket a file under a Storage Root is counted in, and as what.
 * `relative` is root-relative (`raw-footage/a.mkv`). Null for a file outside
 * CVM's folders, which the scan never walks.
 */
export const classifyStorageFile = (
  ownership: StorageOwnership,
  relative: string
): { bucketId: string; kind: StorageFileKind } | null => {
  const folder = relative.split("/")[0] ?? "";
  switch (folder) {
    case STORAGE_FOLDERS.rawFootage:
      return { bucketId: footageBucket(ownership, relative), kind: "footage" };
    case STORAGE_FOLDERS.finishedVideos:
      return {
        bucketId:
          ownership.exports.get(exportName(path.posix.basename(relative))) ??
          ORPHANED_EXPORTS_BUCKET.id,
        kind: "exported-videos",
      };
    case STORAGE_FOLDERS.clipMockups:
      return { bucketId: CLIP_MOCKUPS_BUCKET.id, kind: "other" };
    case STORAGE_FOLDERS.overlayRenders:
      return { bucketId: OVERLAY_RENDER_CACHE_BUCKET.id, kind: "other" };
    default:
      return null;
  }
};
