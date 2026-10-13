import path from "node:path";
import { FileSystem } from "@effect/platform";
import { Data, Effect } from "effect";
import {
  STORAGE_FOLDERS,
  writeFolder,
  type StorageRoots,
} from "@/packages/storage";
import {
  computeExportHash,
  toExportClips,
  type ExportClip,
} from "./export-hash";
import { SIDECAR_SUFFIX } from "./export-sha256-sidecar";
import {
  assertUnderFinishedVideos,
  listFinishedVideosDirectories,
} from "./finished-videos.server";

/**
 * The one-off rename of Exported Videos to their root-relative Export Hash
 * (#2104).
 *
 * The Export Hash used to include each Footage file's ABSOLUTE path; it now
 * includes the path relative to its Storage Root. Every address changes once.
 * Rather than re-encode ~98 GB, each export (and its `.sha256` digest, which
 * also carries its measured duration) is renamed from its old address to its
 * new one.
 *
 * Export garbage collection is OFF until this has completed: before the
 * rename, every export on disk is named by a hash no current Video computes,
 * and a GC would delete them all. Completion is recorded as a marker file in
 * the first root's `finished-videos/` ({@link EXPORT_HASH_RENAME_MARKER}).
 */

/** Written by a completed rename; GC runs only once it exists. */
export const EXPORT_HASH_RENAME_MARKER = ".export-hash-root-relative.json";

const markerPath = (roots: StorageRoots) =>
  path.join(
    writeFolder(roots, STORAGE_FOLDERS.finishedVideos),
    EXPORT_HASH_RENAME_MARKER
  );

/** Whether the rename has completed, so export GC may delete files. */
export const exportHashRenameRecorded = (roots: StorageRoots) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    return yield* fs
      .exists(markerPath(roots))
      .pipe(Effect.orElseSucceed(() => false));
  });

type HashedClip = ExportClip;

const isRelative = (p: string) => p !== "" && !path.posix.isAbsolute(p);

const underRoot = (root: string, p: string) =>
  isRelative(p) ? path.posix.join(root, p) : p;

/** The Clips as they were stored before the data migration, if on `root`. */
const withLegacyRoot = (clips: HashedClip[], root: string): HashedClip[] =>
  clips.map((clip) => ({
    ...clip,
    videoFilename: underRoot(root, clip.videoFilename),
    recordingSession: clip.recordingSession && {
      ...clip.recordingSession,
      cameraFilePath: underRoot(root, clip.recordingSession.cameraFilePath),
      screenFilePath: underRoot(root, clip.recordingSession.screenFilePath),
      micFilePath: underRoot(root, clip.recordingSession.micFilePath),
    },
  }));

/**
 * Every address a Video's export may have had under the OLD, absolute-path
 * Export Hash, whichever order the data migration and this rename run in:
 *
 * - the paths exactly as stored (the migration has not run: they are still
 *   absolute, and the old hash hashed them as they are);
 * - for each root, every relative path put back under that root (the
 *   migration has run: this is what the row said before it did).
 *
 * The current (root-relative) hash is never in the list.
 */
export const legacyExportHashes = (
  clips: HashedClip[],
  format: string | null | undefined,
  roots: StorageRoots
): string[] => {
  const current = computeExportHash(clips, format, roots);
  const candidates = new Set<string>();
  const asStored = computeExportHash(clips, format, []);
  if (asStored) candidates.add(asStored);
  for (const root of roots) {
    const legacy = computeExportHash(withLegacyRoot(clips, root), format, []);
    if (legacy) candidates.add(legacy);
  }
  if (current) candidates.delete(current);
  return [...candidates];
};

/** One Video as the rename sees it. */
export type RenameVideo = {
  readonly videoId: string;
  /** What its export is named after: its Course's id, or its own. */
  readonly namespace: string;
  /** Whether `namespace` is a Course (whose exports GC manages). */
  readonly inCourse: boolean;
  readonly currentHash: string;
  readonly legacyHashes: readonly string[];
};

export type PlannedRename = { readonly from: string; readonly to: string };

export type RenameProblem =
  | {
      readonly kind: "unmatched";
      readonly file: string;
      readonly message: string;
    }
  | {
      readonly kind: "target-exists";
      readonly file: string;
      readonly message: string;
    }
  | {
      readonly kind: "collision";
      readonly file: string;
      readonly message: string;
    };

export type RenamePlan = {
  /** Every rename: each export, then its digest when it has one. */
  readonly renames: readonly PlannedRename[];
  /** Exports already at their current address. */
  readonly alreadyCurrent: readonly string[];
  /** Exports that are no Video's and no Course's: listed, left alone. */
  readonly leftAlone: readonly string[];
  /** Any one of these aborts the rename with zero changes. */
  readonly problems: readonly RenameProblem[];
};

const EXPORT_NAME = /^(.+)-([0-9a-f]{32})\.mp4$/;

/**
 * Plan the rename from the Videos and what is on disk. Pure: nothing is read
 * or written here.
 *
 * An export is matched when its name is `{namespace}-{legacy hash}.mp4` for
 * some Video, and renamed (in the folder it is in) to
 * `{namespace}-{current hash}.mp4`, its `.sha256` digest with it.
 *
 * Problems, any one of which aborts with zero changes:
 * - `unmatched`: an export named after a Course that no Video of that Course
 *   matches under any hash. After the rename, GC would delete it — so a wrong
 *   or missed legacy hash here must stop the rename, not cost an export.
 * - `target-exists`: the new name is already taken (on any root) — usually an
 *   export made after the switch; one of the two copies must go by hand.
 * - `collision`: two exports would be renamed to the same name.
 *
 * Every other export that matches nothing (a Standalone Video's old export, a
 * Short's flat `{videoId}.mp4`) is listed in `leftAlone`: GC never touches
 * those, and nor does this.
 */
export const planExportRename = (input: {
  readonly videos: readonly RenameVideo[];
  readonly listing: readonly { dir: string; files: readonly string[] }[];
}): RenamePlan => {
  const currentNames = new Set<string>();
  const legacyTargets = new Map<string, Set<string>>();
  const courseNamespaces = new Set<string>();

  for (const video of input.videos) {
    if (video.inCourse) courseNamespaces.add(video.namespace);
    const target = `${video.namespace}-${video.currentHash}.mp4`;
    currentNames.add(target);
    for (const legacy of video.legacyHashes) {
      const name = `${video.namespace}-${legacy}.mp4`;
      const targets = legacyTargets.get(name) ?? new Set<string>();
      targets.add(target);
      legacyTargets.set(name, targets);
    }
  }

  const everyFile = new Set(
    input.listing.flatMap(({ files }) => files.map((f) => f))
  );

  const renames: PlannedRename[] = [];
  const alreadyCurrent: string[] = [];
  const leftAlone: string[] = [];
  const problems: RenameProblem[] = [];
  const claimedTargets = new Map<string, string>();

  for (const { dir, files } of input.listing) {
    const here = new Set(files);
    for (const file of [...files].sort()) {
      if (!file.endsWith(".mp4")) continue;
      const full = path.join(dir, file);

      if (currentNames.has(file)) {
        alreadyCurrent.push(full);
        continue;
      }

      const targets = legacyTargets.get(file);
      if (!targets) {
        const named = EXPORT_NAME.exec(file);
        if (named && courseNamespaces.has(named[1]!)) {
          problems.push({
            kind: "unmatched",
            file: full,
            message: `${full} is named after a Course but matches none of its Videos under the old or the new Export Hash; GC would delete it after the rename. Move it out of finished-videos/ (or delete it) and re-run.`,
          });
        } else {
          leftAlone.push(full);
        }
        continue;
      }

      if (targets.size > 1) {
        problems.push({
          kind: "collision",
          file: full,
          message: `${full} matches Videos with different new Export Hashes (${[...targets].join(", ")}).`,
        });
        continue;
      }
      const target = [...targets][0]!;

      if (everyFile.has(target)) {
        problems.push({
          kind: "target-exists",
          file: full,
          message: `${full} would be renamed to ${target}, which already exists in a finished-videos/ folder. Keep one of the two by hand and re-run.`,
        });
        continue;
      }
      const claimedBy = claimedTargets.get(target);
      if (claimedBy !== undefined) {
        problems.push({
          kind: "collision",
          file: full,
          message: `${full} and ${claimedBy} would both be renamed to ${target}.`,
        });
        continue;
      }
      claimedTargets.set(target, full);

      renames.push({ from: full, to: path.join(dir, target) });
      const digest = `${file}${SIDECAR_SUFFIX}`;
      if (here.has(digest)) {
        renames.push({
          from: path.join(dir, digest),
          to: path.join(dir, `${target}${SIDECAR_SUFFIX}`),
        });
      }
    }
  }

  return { renames, alreadyCurrent, leftAlone, problems };
};

/** The rename was refused before anything changed. */
export class ExportRenameAbortedError extends Data.TaggedError(
  "ExportRenameAbortedError"
)<{
  readonly problems: readonly RenameProblem[];
  readonly message: string;
}> {}

/**
 * Perform a plan: refuse it whole if it has any problem, otherwise rename
 * every file (each within its own folder, so each is atomic) and then record
 * completion, which turns export GC back on.
 *
 * A target that appeared since the plan was made stops the run before that
 * rename; the files already renamed are at their current address, so a
 * re-run plans only what is left.
 */
export const applyExportRename = (plan: RenamePlan, roots: StorageRoots) =>
  Effect.gen(function* () {
    if (plan.problems.length > 0) {
      return yield* new ExportRenameAbortedError({
        problems: plan.problems,
        message: `Refusing to rename: ${plan.problems.length} problem(s), nothing was changed.`,
      });
    }
    const fs = yield* FileSystem.FileSystem;
    for (const { from, to } of plan.renames) {
      const source = yield* assertUnderFinishedVideos(roots, from);
      const target = yield* assertUnderFinishedVideos(roots, to);
      if (yield* fs.exists(target)) {
        return yield* new ExportRenameAbortedError({
          problems: [
            {
              kind: "target-exists",
              file: from,
              message: `${to} appeared while renaming; stopped before touching it.`,
            },
          ],
          message: `Stopped: ${to} already exists. Re-run to plan the rest.`,
        });
      }
      yield* fs.rename(source, target);
    }
    const marker = yield* assertUnderFinishedVideos(roots, markerPath(roots));
    yield* fs.makeDirectory(path.dirname(marker), { recursive: true });
    yield* fs.writeFileString(
      marker,
      JSON.stringify(
        {
          completedAt: new Date().toISOString(),
          renamed: plan.renames.length,
          alreadyCurrent: plan.alreadyCurrent.length,
          leftAlone: plan.leftAlone.length,
        },
        null,
        2
      )
    );
    return { renamed: plan.renames.length };
  });

/** A Video as `listVideosForExportHash` (`@cvm/core`) loads it. */
type StoredVideo = {
  readonly id: string;
  readonly format: string;
  readonly courseId: string | null;
  readonly clips: Parameters<typeof toExportClips>[0];
};

/**
 * Plan the rename for every Video in the database against every root's
 * `finished-videos/`. Reads the folders; writes nothing.
 */
export const planExportRenameOnDisk = (
  videos: readonly StoredVideo[],
  roots: StorageRoots
) =>
  Effect.gen(function* () {
    const renameVideos: RenameVideo[] = [];
    for (const video of videos) {
      const clips = toExportClips(video.clips);
      const currentHash = computeExportHash(clips, video.format, roots);
      if (!currentHash) continue;
      renameVideos.push({
        videoId: video.id,
        namespace: video.courseId ?? video.id,
        inCourse: video.courseId !== null,
        currentHash,
        legacyHashes: legacyExportHashes(clips, video.format, roots),
      });
    }
    const listing = yield* listFinishedVideosDirectories(roots);
    return planExportRename({ videos: renameVideos, listing });
  });
