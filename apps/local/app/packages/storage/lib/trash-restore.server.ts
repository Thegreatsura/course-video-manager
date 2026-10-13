import nodeFs from "node:fs/promises";
import path from "node:path";
import { Effect } from "effect";
import {
  messageOf,
  realConfineOf,
  realpathOrNull,
  stopIfCancelled,
} from "./delete-safety.server";
import { STORAGE_FOLDERS, type StorageRoots } from "./storage-roots";
import {
  TRASH_FOLDER,
  trashedAtOf,
  trashExpiresAt,
  TRASH_RETENTION_MS,
  type StorageTrashEntry,
  type StorageTrashOperation,
  type StorageTrashResult,
} from "./trash-wire";

import {
  type Common,
  checkNotBusy,
  footagePathProblem,
  checkRoot,
  regularFileProblem,
  walk,
  removeEmptyParents,
  tally,
  held,
  batchesOf,
  logResult,
  StorageTrashRefusedError,
  StorageTrashFailedError,
  type RestoreFileRef,
  trashFailure,
  type TrashCancelled,
} from "./trash-checks.server";

/** Listing the trash, Restore, "Empty trash" and the 14-day expiry (#2157, ADR 0043). */

/**
 * Every trashed file on every reachable Storage Root, oldest batch first,
 * with when it goes for good. Only reads. A batch folder whose name is not
 * one CVM made is not listed (and never deleted).
 */
export const listStorageTrash = (opts: {
  readonly roots: StorageRoots;
}): Effect.Effect<StorageTrashEntry[], StorageTrashFailedError> =>
  Effect.tryPromise({
    try: async () => {
      const out: StorageTrashEntry[] = [];
      for (const root of opts.roots) {
        const checked = await checkRoot(root, TRASH_FOLDER, null);
        if (checked.problem !== null || checked.realFolder === null) continue;
        for (const b of await batchesOf(path.join(root, TRASH_FOLDER))) {
          const files = await walk(b.dir, b.dir, []).catch(() => []);
          for (const f of files) {
            out.push({
              location: root,
              batch: b.name,
              path: f.relative,
              bytes: f.bytes,
              trashedAt: b.trashedAt.toISOString(),
              expiresAt: trashExpiresAt(b.trashedAt).toISOString(),
            });
          }
        }
      }
      return out.sort((a, b) =>
        a.trashedAt < b.trashedAt ? -1 : a.trashedAt > b.trashedAt ? 1 : 0
      );
    },
    catch: (cause) =>
      new StorageTrashFailedError({ message: messageOf(cause) }),
  });

/**
 * Put trashed files back where they were, on the same Storage Root (#2157).
 * Never overwrites: a file whose place is taken, on any reachable root, is
 * left in the trash and reported.
 */
export const restoreTrashedFootage = (
  opts: Common & { readonly files: readonly RestoreFileRef[] }
): Effect.Effect<
  StorageTrashResult,
  StorageTrashRefusedError | StorageTrashFailedError | TrashCancelled
> =>
  held(
    "a restore from the trash",
    Effect.gen(function* () {
      const dryRun = opts.dryRun ?? false;
      yield* checkNotBusy(opts, true);
      return yield* Effect.tryPromise({
        try: async (): Promise<StorageTrashResult> => {
          const realConfine = await realConfineOf(opts.confineTo);
          const left: StorageTrashResult["left"] = [];
          const done = tally();
          let progressed = 0;
          for (const f of opts.files) {
            stopIfCancelled(opts.cancelRequested);
            const why = await restoreOne(f, opts.roots, realConfine, dryRun);
            if (typeof why === "number") done.add(f.location, why);
            else
              left.push({
                path: f.path,
                location: f.location,
                message: `Left in the trash: ${why}`,
              });
            progressed += 1;
            opts.onProgress?.(progressed, opts.files.length);
          }
          return {
            operation: "restore",
            dryRun,
            batch: null,
            done: done.list(),
            kept: [],
            left,
          };
        },
        catch: trashFailure,
      });
    }),
    opts.alreadyHeld
  ).pipe(Effect.tap(logResult));

/** Restore one file: its size when done (or would be), else why not. */
const restoreOne = async (
  f: RestoreFileRef,
  roots: StorageRoots,
  realConfine: string | null,
  dryRun: boolean
): Promise<number | string> => {
  if (!roots.includes(f.location)) return "not a Storage Root";
  if (trashedAtOf(f.batch) === null) return "not a trash batch CVM made";
  const problem = footagePathProblem(f.path);
  if (problem !== null) return problem;
  const checked = await checkRoot(f.location, TRASH_FOLDER, realConfine);
  if (checked.problem !== null) return checked.problem;
  if (checked.realFolder === null) return "the trash is empty";
  const inTrash = path.posix.join(TRASH_FOLDER, f.batch, f.path);
  const fileProblem = await regularFileProblem(
    f.location,
    checked.realRoot,
    inTrash
  );
  if (fileProblem !== null) return fileProblem;
  // Never overwrite, on any root: the first root's file wins a lookup.
  for (const root of roots) {
    if (
      (await nodeFs.lstat(path.join(root, f.path)).catch(() => null)) !== null
    ) {
      return `something is already at ${f.path} on ${root}`;
    }
  }
  const footage = await checkRoot(
    f.location,
    STORAGE_FOLDERS.rawFootage,
    realConfine
  );
  if (footage.problem !== null) return footage.problem;
  const source = path.join(f.location, inTrash);
  const bytes = Number((await nodeFs.lstat(source)).size);
  if (dryRun) return bytes;
  try {
    const dest = path.join(f.location, f.path);
    await nodeFs.mkdir(path.dirname(dest), { recursive: true });
    const realDestDir = await realpathOrNull(path.dirname(dest));
    if (realDestDir !== path.join(checked.realRoot, path.dirname(f.path))) {
      return `${path.dirname(dest)} is not where it should be (a link?)`;
    }
    if ((await nodeFs.lstat(dest).catch(() => null)) !== null) {
      return `something is already at ${f.path}`;
    }
    await nodeFs.rename(source, dest);
  } catch (error) {
    return messageOf(error);
  }
  await removeEmptyParents(
    path.dirname(source),
    path.join(f.location, TRASH_FOLDER)
  );
  return bytes;
};

/**
 * Delete trashed files for good (#2157): every one ("Empty trash"), or with
 * `olderThanRetention` only batches trashed more than 14 days ago (the
 * Sidecar's sweep). Only batch folders CVM made are touched; inside them,
 * only regular files whose real path is inside the trash.
 */
export const emptyStorageTrash = (
  opts: Common & { readonly olderThanRetention?: boolean }
): Effect.Effect<
  StorageTrashResult,
  StorageTrashRefusedError | StorageTrashFailedError | TrashCancelled
> => {
  const operation: StorageTrashOperation = opts.olderThanRetention
    ? "expire"
    : "empty";
  return held(
    operation === "expire" ? "the trash's clear-out" : "emptying the trash",
    Effect.gen(function* () {
      const now = opts.now ?? new Date();
      const dryRun = opts.dryRun ?? false;
      yield* checkNotBusy(opts, false);
      return yield* Effect.tryPromise({
        try: async (): Promise<StorageTrashResult> => {
          const realConfine = await realConfineOf(opts.confineTo);
          const left: StorageTrashResult["left"] = [];
          const done = tally();
          type Doomed = {
            root: string;
            file: string;
            realBatch: string;
            relative: string;
            bytes: number;
            batchDir: string;
          };
          const doomed: Doomed[] = [];
          for (const root of opts.roots) {
            const checked = await checkRoot(root, TRASH_FOLDER, realConfine);
            if (checked.problem !== null) {
              if (!checked.problem.endsWith("is Offline")) {
                left.push({
                  path: TRASH_FOLDER,
                  location: root,
                  message: `Left: ${checked.problem}`,
                });
              }
              continue;
            }
            if (checked.realFolder === null) continue;
            for (const b of await batchesOf(path.join(root, TRASH_FOLDER))) {
              if (
                opts.olderThanRetention &&
                now.getTime() - b.trashedAt.getTime() < TRASH_RETENTION_MS
              ) {
                continue;
              }
              const realBatch = path.join(checked.realFolder, b.name);
              if ((await realpathOrNull(b.dir)) !== realBatch) {
                left.push({
                  path: `${TRASH_FOLDER}/${b.name}`,
                  location: root,
                  message: "Left: it is a link",
                });
                continue;
              }
              const links: string[] = [];
              const files = await walk(b.dir, b.dir, links);
              for (const l of links) {
                left.push({
                  path: l,
                  location: root,
                  message: "Left: a link, never followed or deleted",
                });
              }
              for (const f of files) {
                doomed.push({
                  root,
                  file: path.join(b.dir, f.relative),
                  realBatch,
                  relative: f.relative,
                  bytes: f.bytes,
                  batchDir: b.dir,
                });
              }
            }
          }
          let progressed = 0;
          for (const d of doomed) {
            stopIfCancelled(opts.cancelRequested);
            const info = await nodeFs.lstat(d.file).catch(() => null);
            const real = await realpathOrNull(d.file);
            if (info === null || !info.isFile()) {
              left.push({
                path: d.relative,
                location: d.root,
                message: "Left: not a regular file",
              });
            } else if (real !== path.join(d.realBatch, d.relative)) {
              left.push({
                path: d.relative,
                location: d.root,
                message: `Left: it really is ${real ?? "unresolvable"}`,
              });
            } else if (dryRun) {
              done.add(d.root, d.bytes);
            } else {
              try {
                await nodeFs.unlink(d.file);
                done.add(d.root, d.bytes);
                await removeEmptyParents(
                  path.dirname(d.file),
                  path.dirname(d.batchDir)
                );
              } catch (error) {
                left.push({
                  path: d.relative,
                  location: d.root,
                  message: messageOf(error),
                });
              }
            }
            progressed += 1;
            opts.onProgress?.(progressed, doomed.length);
          }
          return {
            operation,
            dryRun,
            batch: null,
            done: done.list(),
            kept: [],
            left,
          };
        },
        catch: trashFailure,
      });
    }),
    opts.alreadyHeld
  ).pipe(Effect.tap(logResult));
};

/** Whether any trash batch is older than 14 days: what the sweep asks first. */
export const trashHasExpired = (opts: {
  readonly roots: StorageRoots;
  readonly now?: Date;
}): Effect.Effect<boolean, StorageTrashFailedError> =>
  Effect.tryPromise({
    try: async () => {
      const now = (opts.now ?? new Date()).getTime();
      for (const root of opts.roots) {
        for (const b of await batchesOf(path.join(root, TRASH_FOLDER))) {
          if (now - b.trashedAt.getTime() >= TRASH_RETENTION_MS) return true;
        }
      }
      return false;
    },
    catch: (cause) =>
      new StorageTrashFailedError({ message: messageOf(cause) }),
  });
