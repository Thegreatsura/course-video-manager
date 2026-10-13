import nodeFs from "node:fs/promises";
import path from "node:path";
import { holdingStorageWrites } from "./storage-busy";
import { Data, Effect } from "effect";
import { videos as videosTable } from "@cvm/core/db/schema";
import { listVideosForExportHash } from "@cvm/core/services/db-export-hash-videos.server";
import type { Database } from "@cvm/core/services/drizzle-service.server";
import { clipSource } from "@/packages/clip-source";
import { EXPORT_HASH_RENAME_MARKER } from "@/services/export-hash-rename";
import { computeExportHash, toExportClips } from "@/services/export-hash";
import { classifyStorageFile } from "./buckets";
import {
  encodingJobs,
  encodingRefusalMessage,
  storageBusyMessage,
  fileRefusal,
  folderRefusal,
  listFiles,
  messageOf,
  realConfineOf,
  realRootsAndFootage,
  type DeleteLocation,
} from "./delete-safety.server";
import { loadStorageOwnership } from "./ownership.server";
import {
  PURGEABLE_STORAGE_BUCKET_KINDS,
  type StoragePurgeResult,
  type StoragePurgeSkippedVideo,
} from "./purge-wire";
import {
  rootLabel,
  rootRelativePath,
  STORAGE_FOLDERS,
  type StorageRoots,
} from "./storage-roots";

/**
 * Why a bucket's Exported Videos were not Purged. Nothing was deleted.
 *
 * - `not-purgeable`: only a Course's, Standalone Videos' and Shorts'
 *   Exported Videos can be Purged. Footage of any kind, Clip Mockups and the
 *   Other buckets never can be from here (ADR 0041).
 * - `export-running`: an export, a vertical render or a Publish is queued or
 *   running. It writes into `finished-videos/`, and a Publish reads the very
 *   files a Purge would delete.
 */
export class StoragePurgeRefusedError extends Data.TaggedError(
  "StoragePurgeRefusedError"
)<{
  readonly bucketId: string;
  readonly reason: "not-purgeable" | "export-running" | "storage-busy";
  readonly message: string;
}> {}

/** Reading the roots or the database failed before anything was deleted. */
export class StoragePurgeFailedError extends Data.TaggedError(
  "StoragePurgeFailedError"
)<{ readonly bucketId: string; readonly message: string }> {}

/** A regular, non-empty file (links followed): Footage an export can read. */
const isFootageFile = async (file: string) => {
  const info = await nodeFs.stat(file).catch(() => null);
  return info !== null && info.isFile() && info.size > 0;
};

const rootIsReadable = (root: string) =>
  nodeFs.readdir(root).then(
    () => true,
    () => false
  );

/**
 * Why the Footage a row stores can't be read for an export, or null when it
 * is on some reachable Storage Root (or, under no root, where it is stored).
 * Only reads.
 */
const footageProblem = async (
  stored: string,
  roots: StorageRoots
): Promise<string | null> => {
  const relative = rootRelativePath(stored, roots);
  if (relative === null) {
    return (await isFootageFile(stored))
      ? null
      : `Footage not found: ${stored}`;
  }
  for (const root of roots) {
    if (await isFootageFile(path.join(root, relative))) return null;
  }
  const offline: string[] = [];
  for (const root of roots) {
    if (!(await rootIsReadable(root))) offline.push(rootLabel(root));
  }
  return offline.length === 0
    ? `Footage not found on any Storage Root: ${relative}`
    : `Footage not found (${offline.join(", ")} offline?): ${relative}`;
};

type VideoForPurge = Awaited<
  ReturnType<typeof listVideosForExportHash>
>[number];

/**
 * Why this Video could not be exported again, or null when it can: every
 * file its live Clips are drawn from (an OBS Clip's Footage, a CVM-recorder
 * Clip's camera, screen and mic) is found. A Video with no Clips has nothing
 * to export from.
 */
const reexportProblem = async (
  video: VideoForPurge,
  roots: StorageRoots,
  checked: Map<string, string | null>
): Promise<string | null> => {
  if (video.clips.length === 0) {
    return "it has no Clips, so it can't be exported again";
  }
  for (const clip of toExportClips(video.clips)) {
    const source = clipSource(clip);
    const files =
      source.kind === "footage"
        ? [source.footagePath]
        : [source.files.camera, source.files.screen, source.files.mic].filter(
            (f): f is string => f !== null
          );
    for (const stored of files) {
      if (!checked.has(stored)) {
        checked.set(stored, await footageProblem(stored, roots));
      }
      const problem = checked.get(stored);
      if (problem) return problem;
    }
  }
  return null;
};

/** The names in `finished-videos/` that are each Video's export. */
const exportNamesOf = (video: VideoForPurge, roots: StorageRoots) => {
  const hash = computeExportHash(
    toExportClips(video.clips),
    video.format,
    roots
  );
  const names = [`${video.id}.mp4`];
  if (hash) names.push(`${video.courseId ?? video.id}-${hash}.mp4`);
  return names;
};

/** One file of the bucket on one root, and the Exported Video it goes with. */
type ExportFile = {
  readonly at: DeleteLocation;
  readonly file: string;
  /** Root-relative, as the per-bucket page lists it. */
  readonly relative: string;
  /** The Exported Video it is (or is a companion of), root-relative. */
  readonly exportPath: string;
  readonly bytes: number;
};

/**
 * Purge a Storage Bucket's Exported Videos (#2111): delete each Video's
 * current Exported Video (hashed and flat `{videoId}.mp4`) and its companions
 * (`.sha256`), on whichever roots hold them, so the Video becomes an
 * Unexported Video and the next Publish exports it again.
 *
 * Only a Course's, Standalone Videos' or Shorts' bucket, and refused while an
 * export, vertical render or Publish is queued or running. A Video is
 * eligible only when every file its live Clips are drawn from is found on a
 * reachable root: otherwise its exports are kept and it is listed as skipped,
 * so an export is never deleted unless it can be made again. An Exported
 * Video that more than one Video names goes only if every one of them is
 * eligible. What owns each file is read fresh from the database here, never
 * taken from the page.
 *
 * `exportPaths` (root-relative, `finished-videos/x.mp4`) keeps the Purge to
 * the Exported Videos ticked on the per-bucket page; absent, the whole
 * bucket. `dryRun` deletes nothing and answers what would go: the
 * confirmation.
 *
 * Each file is checked on disk first (`fileRefusal`): a regular file, really
 * inside `<root>/finished-videos`, under no `raw-footage/`, named as an
 * export. One that fails, or that Windows won't let go of, is left and
 * reported, and the rest still go.
 */
export const purgeExportedVideos = (opts: {
  readonly db: Database;
  readonly roots: StorageRoots;
  readonly bucketId: string;
  readonly exportPaths?: readonly string[];
  readonly dryRun?: boolean;
  /** Delete nothing outside this folder (a verify-cvm run's own directory). */
  readonly confineTo?: string;
}): Effect.Effect<
  StoragePurgeResult,
  StoragePurgeRefusedError | StoragePurgeFailedError
> =>
  Effect.gen(function* () {
    const { bucketId, roots } = opts;
    const dryRun = opts.dryRun ?? false;
    const failed = (cause: unknown) =>
      new StoragePurgeFailedError({ bucketId, message: messageOf(cause) });

    const ownership = yield* loadStorageOwnership(opts.db, roots).pipe(
      Effect.mapError(
        (e) => new StoragePurgeFailedError({ bucketId, message: e.message })
      )
    );
    const bucket = ownership.buckets.find((b) => b.id === bucketId);
    if (
      bucket === undefined ||
      !(PURGEABLE_STORAGE_BUCKET_KINDS as readonly string[]).includes(
        bucket.kind
      )
    ) {
      return yield* new StoragePurgeRefusedError({
        bucketId,
        reason: "not-purgeable",
        message: `"${bucketId}" has no Exported Videos that can be deleted: only a Course's, Standalone Videos' and Shorts' can`,
      });
    }

    const encoding = yield* Effect.tryPromise({
      try: () => encodingJobs(opts.db),
      catch: (cause) =>
        new StoragePurgeFailedError({
          bucketId,
          message: `Could not check for a running export: ${messageOf(cause)}`,
        }),
    });
    if (encoding.length > 0) {
      return yield* new StoragePurgeRefusedError({
        bucketId,
        reason: "export-running",
        message: encodingRefusalMessage(encoding),
      });
    }

    const [videos, titles] = yield* Effect.tryPromise({
      try: () =>
        Promise.all([
          listVideosForExportHash(opts.db),
          opts.db
            .select({ id: videosTable.id, title: videosTable.title })
            .from(videosTable),
        ]),
      catch: failed,
    });

    return yield* Effect.tryPromise({
      try: async (): Promise<StoragePurgeResult> => {
        const titleOf = new Map(titles.map((t) => [t.id, t.title]));
        const namedBy = new Map<string, VideoForPurge[]>();
        for (const video of videos) {
          for (const name of exportNamesOf(video, roots)) {
            namedBy.set(name, [...(namedBy.get(name) ?? []), video]);
          }
        }
        const selected =
          opts.exportPaths === undefined ? null : new Set(opts.exportPaths);

        const { realRoots, realFootageFolders } =
          await realRootsAndFootage(roots);
        const realConfine = await realConfineOf(opts.confineTo);
        const left: StoragePurgeResult["left"] = [];

        // The bucket's Exported Videos and companions, on every root.
        const found: ExportFile[] = [];
        for (const root of roots) {
          const at: DeleteLocation = {
            location: root,
            folder: path.join(root, STORAGE_FOLDERS.finishedVideos),
            root,
          };
          let files: string[];
          try {
            // A root or folder that is missing or Offline has nothing here.
            files = await listFiles(at.folder);
          } catch {
            continue;
          }
          const inBucket: ExportFile[] = [];
          for (const file of files) {
            if (path.basename(file) === EXPORT_HASH_RENAME_MARKER) continue;
            const relative = path
              .relative(root, file)
              .split(path.sep)
              .join("/");
            const cls = classifyStorageFile(ownership, relative);
            if (cls?.bucketId !== bucketId) continue;
            if (cls.kind !== "exported-videos") continue;
            const exportPath = cls.companionOf ?? relative;
            if (selected !== null && !selected.has(exportPath)) continue;
            const info = await nodeFs.lstat(file).catch(() => null);
            inBucket.push({
              at,
              file,
              relative,
              exportPath,
              bytes: info?.size ?? 0,
            });
          }
          if (inBucket.length === 0) continue;
          const unsafe = await folderRefusal(at, realRoots, realConfine);
          if (unsafe !== null) {
            left.push({
              path: STORAGE_FOLDERS.finishedVideos,
              location: root,
              message: `Left, all ${inBucket.length} files: ${unsafe}`,
            });
            continue;
          }
          found.push(...inBucket);
        }

        // Which Videos can be exported again: only theirs go.
        const checked = new Map<string, string | null>();
        const problemOf = new Map<string, string | null>();
        const videoProblem = async (video: VideoForPurge) => {
          if (!problemOf.has(video.id)) {
            problemOf.set(
              video.id,
              await reexportProblem(video, roots, checked)
            );
          }
          return problemOf.get(video.id) ?? null;
        };

        const purgedVideos = new Set<string>();
        const skipped = new Map<string, StoragePurgeSkippedVideo>();
        const deleted = new Map<string, { files: number; bytes: number }>();
        for (const f of found) {
          const exportName = path.posix.basename(f.exportPath);
          const owners = namedBy.get(exportName) ?? [];
          if (owners.length === 0) continue;
          // Not directly in finished-videos/: no export is written there.
          if (
            path.posix.dirname(f.exportPath) !== STORAGE_FOLDERS.finishedVideos
          ) {
            left.push({
              path: f.relative,
              location: f.at.location,
              message: "Left: it is not directly in finished-videos/",
            });
            continue;
          }
          let blocked = false;
          for (const video of owners) {
            const problem = await videoProblem(video);
            if (problem === null) continue;
            blocked = true;
            const was = skipped.get(video.id);
            skipped.set(video.id, {
              videoId: video.id,
              title: titleOf.get(video.id) ?? "",
              reason: problem,
              bytes: (was?.bytes ?? 0) + f.bytes,
            });
          }
          if (blocked) continue;
          const refusal = await fileRefusal({
            at: f.at,
            file: f.file,
            realFootageFolders,
            exportsOnly: true,
          });
          if (refusal !== null) {
            left.push({
              path: f.relative,
              location: f.at.location,
              message: `Left: ${refusal}`,
            });
            continue;
          }
          if (!dryRun) {
            try {
              await nodeFs.unlink(f.file);
            } catch (error) {
              // Windows has it open, say: left and reported, not fatal.
              left.push({
                path: f.relative,
                location: f.at.location,
                message: messageOf(error),
              });
              continue;
            }
          }
          for (const video of owners) purgedVideos.add(video.id);
          const was = deleted.get(f.at.location) ?? { files: 0, bytes: 0 };
          deleted.set(f.at.location, {
            files: was.files + 1,
            bytes: was.bytes + f.bytes,
          });
        }

        return {
          bucketId,
          dryRun,
          videos: purgedVideos.size,
          deleted: [...deleted].map(([location, d]) => ({ location, ...d })),
          skipped: [...skipped.values()],
          left,
        };
      },
      catch: failed,
    });
  }).pipe(
    Effect.tap((r) =>
      r.dryRun
        ? Effect.void
        : Effect.logInfo(
            `[storage] purged ${r.bucketId}: ${r.videos} Videos, ${r.deleted.reduce((n, d) => n + d.files, 0)} files, ${r.skipped.length} Videos skipped, ${r.left.length} files left`
          )
    ),
    // Never beside a move being started, or another delete (#2109).
    (purge) =>
      holdingStorageWrites(
        "a Purge",
        (heldBy) =>
          new StoragePurgeRefusedError({
            bucketId: opts.bucketId,
            reason: "storage-busy",
            message: storageBusyMessage(heldBy),
          }),
        purge
      )
  );
