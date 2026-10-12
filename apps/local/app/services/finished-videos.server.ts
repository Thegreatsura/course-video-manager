import path from "node:path";
import { FileSystem } from "@effect/platform";
import { Effect, Option } from "effect";
import {
  folderOnEveryRoot,
  STORAGE_FOLDERS,
  writeFolder,
  type StorageRoots,
} from "@/packages/storage";
import { findStoragePath } from "@/packages/storage/server";
import {
  assertUnderEffect,
  isUnder,
  PathOutsideBaseDirError,
} from "./assert-under";

/**
 * Exported Videos across Storage Roots. An Exported Video is named
 * `finished-videos/<file>` relative to a root; it is found on the first root
 * that has it, and a new one is written to the first root.
 */

const relativeExport = (filename: string) =>
  path.posix.join(STORAGE_FOLDERS.finishedVideos, filename);

/** The Exported Video named `filename` on the first root that has it. */
export const findExportedVideo = (roots: StorageRoots, filename: string) =>
  findStoragePath(relativeExport(filename), roots);

/**
 * Where the Exported Video named `filename` is: the first root that has it,
 * or — when no root does — where a new export of it is written (the first
 * root's `finished-videos/`).
 */
export const locateExportedVideo = (roots: StorageRoots, filename: string) =>
  Effect.map(findExportedVideo(roots, filename), (found) =>
    Option.getOrElse(found, () =>
      path.join(writeFolder(roots, STORAGE_FOLDERS.finishedVideos), filename)
    )
  );

/**
 * Guard a path to an Exported Video before it is written or deleted: it must
 * be inside `finished-videos/` on one of the roots. The `assertUnder` of the
 * root that holds it is what the caller gets back.
 */
export const assertUnderFinishedVideos = (
  roots: StorageRoots,
  target: string
): Effect.Effect<string, PathOutsideBaseDirError> => {
  const dirs = folderOnEveryRoot(roots, STORAGE_FOLDERS.finishedVideos);
  const holder = dirs.find((dir) => isUnder(dir, target)) ?? dirs[0]!;
  return assertUnderEffect(holder, target);
};

/** Every root's `finished-videos/` that exists, with its file names. */
export const listFinishedVideosDirectories = (roots: StorageRoots) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const listed: { dir: string; files: string[] }[] = [];
    for (const dir of folderOnEveryRoot(
      roots,
      STORAGE_FOLDERS.finishedVideos
    )) {
      const exists = yield* fs
        .exists(dir)
        .pipe(Effect.orElseSucceed(() => false));
      if (!exists) continue;
      listed.push({ dir, files: yield* fs.readDirectory(dir) });
    }
    return listed;
  });
