import nodeFs from "node:fs/promises";
import path from "node:path";
import { and, inArray } from "drizzle-orm";
import { Data, Effect } from "effect";
import { jobs } from "@cvm/core/db/schema";
import type { Database } from "@cvm/core/services/drizzle-service.server";
import { assertUnder } from "@/services/assert-under";
import { EXPORT_HASH_RENAME_MARKER } from "@/services/export-hash-rename";
import {
  classifyStorageFile,
  EXPORT_SCRATCH_BUCKET,
  ORPHANED_EXPORTS_BUCKET,
  OVERLAY_RENDER_CACHE_BUCKET,
  type StorageOwnership,
} from "./buckets";
import { loadStorageOwnership } from "./ownership.server";
import {
  DELETABLE_STORAGE_BUCKETS,
  type DeletableStorageBucketId,
  type StorageDeleteResult,
} from "./scan-wire";
import {
  STORAGE_FOLDERS,
  writeFolder,
  type StorageFolder,
  type StorageRoots,
} from "./storage-roots";

/**
 * Why a Storage Bucket's files were not deleted. Nothing was deleted.
 *
 * - `not-deletable`: only the Overlay Render Cache, export scratch and
 *   Exported Videos of no current Video can be deleted. Footage of any kind
 *   (Unused Footage included), Clip Mockups and a Course's, Standalone
 *   Videos' or Shorts' buckets never can be from here (ADR 0041).
 * - `export-running`: an export, a vertical render or a Publish is queued or
 *   running; it writes export scratch, reads Overlay renders and writes into
 *   `finished-videos/`.
 * - `exports-not-renamed`: the one-off rename of Exported Videos to their
 *   root-relative Export Hash (#2104) has not been recorded. Until it has,
 *   every Exported Video is named by a hash no Video computes, so every one
 *   would look orphaned.
 */
export class StorageDeleteRefusedError extends Data.TaggedError(
  "StorageDeleteRefusedError"
)<{
  readonly bucketId: string;
  readonly reason: "not-deletable" | "export-running" | "exports-not-renamed";
  readonly message: string;
}> {}

/** Reading the roots or the database failed before anything was deleted. */
export class StorageDeleteFailedError extends Data.TaggedError(
  "StorageDeleteFailedError"
)<{ readonly bucketId: string; readonly message: string }> {}

/**
 * The Job kinds that encode: each writes export scratch, and the export and
 * the vertical render read (and write) the Overlay Render Cache and write
 * `finished-videos/`. A Publish exports its Videos.
 */
const ENCODING_JOB_KINDS = [
  "export",
  "batch-export",
  "render-vertical",
  "publish",
] as const;

const messageOf = (e: unknown) =>
  e instanceof Error
    ? e.message
    : typeof e === "object" && e !== null && "message" in e
      ? String((e as { message: unknown }).message)
      : String(e);

const isInside = (base: string, target: string) => {
  const relative = path.relative(base, target);
  return (
    relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
  );
};

const isAtOrInside = (base: string, target: string) =>
  base === target || isInside(base, target);

const realpathOrNull = async (p: string) => {
  try {
    return await nodeFs.realpath(p);
  } catch {
    return null;
  }
};

/** Every regular file under `dir` (symlinks are listed, never followed). */
const listFiles = async (dir: string): Promise<string[]> => {
  const out: string[] = [];
  const entries = await nodeFs.readdir(dir, { withFileTypes: true });
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listFiles(full)));
    else out.push(full);
  }
  return out;
};

/** Empty folders left under `dir` once its files are gone; `dir` itself stays. */
const removeEmptyFolders = async (dir: string) => {
  const entries = await nodeFs
    .readdir(dir, { withFileTypes: true })
    .catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const sub = path.join(dir, entry.name);
    await removeEmptyFolders(sub);
    // rmdir only ever removes an EMPTY folder.
    await nodeFs.rmdir(sub).catch(() => undefined);
  }
};

/**
 * One place the bucket's files are: a folder, and what it must really be on
 * disk. `realFolder` is checked before anything in it is touched.
 */
type Location = {
  /** Where the file is reported as being (a Storage Root, or export scratch). */
  readonly location: string;
  /** The folder walked. */
  readonly folder: string;
  /** Root-relative paths are classified against this root; null for scratch. */
  readonly root: string | null;
};

const locationsOf = (
  bucketId: DeletableStorageBucketId,
  roots: StorageRoots,
  scratchDir: string
): Location[] => {
  if (bucketId === EXPORT_SCRATCH_BUCKET.id) {
    return [{ location: scratchDir, folder: scratchDir, root: null }];
  }
  const folder: StorageFolder =
    bucketId === OVERLAY_RENDER_CACHE_BUCKET.id
      ? STORAGE_FOLDERS.overlayRenders
      : STORAGE_FOLDERS.finishedVideos;
  return roots.map((root) => ({
    location: root,
    folder: path.join(root, folder),
    root,
  }));
};

/** An Exported Video or its companion (`x.mp4`, `x.mp4.sha256`). */
const looksLikeAnExport = (name: string) =>
  !name.startsWith(".") && /\.mp4(\..+)?$/.test(name);

/**
 * Why the bucket's folder at `at` must not be touched at all, or null. It must
 * really be where it is named: `<root>/overlay-renders` itself, not a link to
 * `raw-footage/` or anywhere else; export scratch must hold no Storage Root
 * and be on none. With `realConfine` (a verify-cvm run's own directory) it
 * must be inside that too.
 */
const folderRefusal = async (
  at: Location,
  realRoots: readonly string[],
  realConfine: string | null
): Promise<string | null> => {
  const realFolder = await realpathOrNull(at.folder);
  if (realFolder === null) return "it can't be resolved";
  if (realConfine !== null && !isAtOrInside(realConfine, realFolder)) {
    return `${realFolder} is outside ${realConfine}, the only place this run may delete`;
  }
  if (at.root === null) {
    if (realRoots.some((r) => isAtOrInside(r, realFolder))) {
      return `export scratch ${realFolder} is on a Storage Root`;
    }
    if (realRoots.some((r) => isAtOrInside(realFolder, r))) {
      return `export scratch ${realFolder} holds a Storage Root`;
    }
    return null;
  }
  const realRoot = await realpathOrNull(at.root);
  const expected =
    realRoot === null
      ? null
      : path.join(realRoot, path.relative(at.root, at.folder));
  return realFolder === expected
    ? null
    : `${at.folder} really is ${realFolder}, not ${expected}`;
};

/**
 * Why the file at `file` is not one this bucket may delete, or null when it
 * is. It must be a regular file, not a link; its real path (every symlink
 * followed) must be strictly inside the bucket's real folder and under no
 * root's `raw-footage/`, whatever else holds; and an Exported Video of no
 * current Video must be named as one (`x.mp4`, `x.mp4.sha256`).
 */
const fileRefusal = async (opts: {
  readonly bucketId: DeletableStorageBucketId;
  readonly at: Location;
  readonly file: string;
  readonly realFootageFolders: readonly string[];
}): Promise<string | null> => {
  const { at, file } = opts;
  const info = await nodeFs.lstat(file).catch(() => null);
  if (info === null) return "it is gone";
  if (!info.isFile()) return "it is not a regular file (a link?)";
  try {
    assertUnder(at.folder, file);
  } catch (error) {
    return messageOf(error);
  }
  const realFolder = await realpathOrNull(at.folder);
  const realFile = await realpathOrNull(file);
  if (realFolder === null || realFile === null) return "it can't be resolved";
  if (!isInside(realFolder, realFile)) {
    return `it really is ${realFile}, outside ${realFolder}`;
  }
  if (opts.realFootageFolders.some((f) => isAtOrInside(f, realFile))) {
    return `it really is ${realFile}, raw Footage, which is never deleted`;
  }
  if (
    opts.bucketId === ORPHANED_EXPORTS_BUCKET.id &&
    !looksLikeAnExport(path.basename(file))
  ) {
    return "it is not an Exported Video or its companion";
  }
  return null;
};

/**
 * Whether the database says the file at `file` is this bucket's. Everything
 * in export scratch is; on a root, it is classified exactly as the scan
 * classifies it, from ownership read fresh for this delete.
 */
const inBucket = (
  bucketId: DeletableStorageBucketId,
  at: Location,
  file: string,
  ownership: StorageOwnership
) => {
  if (at.root === null) return true;
  const relative = path.relative(at.root, file).split(path.sep).join("/");
  return classifyStorageFile(ownership, relative)?.bucketId === bucketId;
};

/**
 * Delete every file of one deletable Other Storage Bucket, on every root:
 * the Overlay Render Cache (re-rendered on demand), export scratch, or the
 * Exported Videos of no current Video (#1493's standalone orphans and
 * legacy flat files of deleted Videos included).
 *
 * Every other bucket is refused outright: raw Footage, Unused Footage
 * included, is never deletable, and Clip Mockups are only viewed and moved
 * (ADR 0041). What owns each file is read fresh from the database here, never
 * taken from the page. Each file is checked on disk first (`refusalFor`);
 * one that fails the check, or that Windows won't let go of, is left and
 * reported, and the rest still go.
 */
export const deleteOtherStorageBucket = (opts: {
  readonly db: Database;
  readonly roots: StorageRoots;
  readonly bucketId: string;
  /** Where exports are encoded before they reach `finished-videos/`. */
  readonly scratchDir: string;
  /**
   * Delete nothing outside this folder (a verify-cvm run's own directory):
   * its export scratch is the OS temp folder Matt's own app encodes in.
   */
  readonly confineTo?: string;
}): Effect.Effect<
  StorageDeleteResult,
  StorageDeleteRefusedError | StorageDeleteFailedError
> =>
  Effect.gen(function* () {
    const bucketId = DELETABLE_STORAGE_BUCKETS.find(
      (id) => id === opts.bucketId
    );
    if (bucketId === undefined) {
      return yield* new StorageDeleteRefusedError({
        bucketId: opts.bucketId,
        reason: "not-deletable",
        message: `"${opts.bucketId}" can't be deleted from the Storage page: only the Overlay Render Cache, export scratch and Exported Videos of no current Video can`,
      });
    }

    const encoding = yield* Effect.tryPromise({
      try: () =>
        opts.db
          .select({ kind: jobs.kind, title: jobs.title })
          .from(jobs)
          .where(
            and(
              inArray(jobs.kind, [...ENCODING_JOB_KINDS]),
              inArray(jobs.status, ["queued", "running"])
            )
          ),
      catch: (cause) =>
        new StorageDeleteFailedError({
          bucketId,
          message: `Could not check for a running export: ${messageOf(cause)}`,
        }),
    });
    if (encoding.length > 0) {
      return yield* new StorageDeleteRefusedError({
        bucketId,
        reason: "export-running",
        message: `Not deleted: ${encoding.length === 1 ? "an export is" : `${encoding.length} exports are`} queued or running (${encoding[0]!.title}). Try again once it has finished.`,
      });
    }

    if (bucketId === ORPHANED_EXPORTS_BUCKET.id) {
      const marker = path.join(
        writeFolder(opts.roots, STORAGE_FOLDERS.finishedVideos),
        EXPORT_HASH_RENAME_MARKER
      );
      const renamed = yield* Effect.tryPromise({
        // A marker that can't be read counts as missing: refused.
        try: () =>
          nodeFs.access(marker).then(
            () => true,
            () => false
          ),
        catch: (cause) =>
          new StorageDeleteFailedError({ bucketId, message: messageOf(cause) }),
      });
      if (!renamed) {
        return yield* new StorageDeleteRefusedError({
          bucketId,
          reason: "exports-not-renamed",
          message:
            "Not deleted: the Exported Video rename to root-relative Export Hashes has not been recorded (apps/local/scripts/storage-rename-exports.ts --apply). Until then every Exported Video looks orphaned.",
        });
      }
    }

    const ownership = yield* loadStorageOwnership(opts.db, opts.roots).pipe(
      Effect.mapError(
        (e) => new StorageDeleteFailedError({ bucketId, message: e.message })
      )
    );

    return yield* Effect.tryPromise({
      try: async (): Promise<StorageDeleteResult> => {
        const realRoots = (
          await Promise.all(opts.roots.map(realpathOrNull))
        ).filter((r): r is string => r !== null);
        const realFootageFolders = (
          await Promise.all(
            opts.roots.map((r) =>
              realpathOrNull(path.join(r, STORAGE_FOLDERS.rawFootage))
            )
          )
        ).filter((r): r is string => r !== null);

        const realConfine =
          opts.confineTo === undefined
            ? null
            : ((await realpathOrNull(opts.confineTo)) ?? opts.confineTo);
        const result: StorageDeleteResult = {
          bucketId,
          deleted: [],
          left: [],
        };
        for (const at of locationsOf(bucketId, opts.roots, opts.scratchDir)) {
          let files: string[];
          try {
            // A root or folder that is missing or Offline has nothing to delete.
            files = await listFiles(at.folder);
          } catch {
            continue;
          }
          const unsafe = await folderRefusal(at, realRoots, realConfine);
          if (unsafe !== null) {
            result.left.push({
              path: path.relative(at.location, at.folder) || ".",
              location: at.location,
              message: `Left, all ${files.length} files: ${unsafe}`,
            });
            continue;
          }
          let count = 0;
          let bytes = 0;
          for (const file of files) {
            // GC's switch, not an export: never deleted, and not news.
            if (path.basename(file) === EXPORT_HASH_RENAME_MARKER) continue;
            if (!inBucket(bucketId, at, file, ownership)) continue;
            const shown = path
              .relative(at.location, file)
              .split(path.sep)
              .join("/");
            const refusal = await fileRefusal({
              bucketId,
              at,
              file,
              realFootageFolders,
            });
            if (refusal !== null) {
              result.left.push({
                path: shown,
                location: at.location,
                message: `Left: ${refusal}`,
              });
              continue;
            }
            try {
              const size = (await nodeFs.lstat(file)).size;
              await nodeFs.unlink(file);
              count += 1;
              bytes += size;
            } catch (error) {
              // Windows has it open, say: left and reported, not fatal.
              result.left.push({
                path: shown,
                location: at.location,
                message: messageOf(error),
              });
            }
          }
          if (count > 0) {
            result.deleted.push({ location: at.location, files: count, bytes });
          }
          if (bucketId !== ORPHANED_EXPORTS_BUCKET.id) {
            await removeEmptyFolders(at.folder);
          }
        }
        return result;
      },
      catch: (cause) =>
        new StorageDeleteFailedError({ bucketId, message: messageOf(cause) }),
    });
  }).pipe(
    Effect.tap((r) =>
      Effect.logInfo(
        `[storage] deleted ${r.bucketId}: ${r.deleted.reduce((n, d) => n + d.files, 0)} files, ${r.left.length} left`
      )
    )
  );
