import { FileSystem } from "@effect/platform";
import { isUnder } from "./assert-under";
import type { PlatformError } from "@effect/platform/Error";
import { Data, Effect } from "effect";
import path from "node:path";
import {
  folderOnEveryRoot,
  STORAGE_FOLDERS,
  writeFolder,
} from "@/packages/storage";
import { findStoragePathSync } from "@/packages/storage/server";
import { readStorageRootsSync } from "./storage-roots";

/**
 * The per-Video Clip Mockup frame store.
 *
 * Frames live on disk at `clip-mockups/{video.lineageId}/{relativePath}` on a
 * Storage Root (written to the first root, read from whichever has them)
 * and the row carries only that relative path — so the CVM keeps its OWN copy
 * of every frame and an authoring agent clearing its scratch folder cannot
 * empty a Video's Animatic.
 *
 * DELIBERATELY NOT UNDER THE VIDEO FILES STORE. A Video File is Article Writer
 * context; sixty frames would drown the writer's context picker. Same
 * directory-is-the-state convention, different directory, on purpose.
 *
 * This module is the only thing that resolves a Clip Mockup path. It lives in
 * `apps/local` rather than `@cvm/core` because `@cvm/core` is deployed to a
 * box with no disk at all — the row half of the noun is over there, the file
 * half is here, and the CLI is what joins them.
 */

/** Raised when a caller-supplied path escapes the Video's frame directory. */
export class InvalidClipMockupPathError extends Data.TaggedError(
  "InvalidClipMockupPathError"
)<{
  readonly path: string;
  readonly message: string;
}> {}

/**
 * Where new frames are written: `clip-mockups/` on the first Storage Root.
 * Reads look on every root ({@link locateClipMockupFile}). Throws, naming
 * `STORAGE_ROOTS`, when that setting is missing.
 *
 * `STORAGE_ROOTS` is read through `resolveRepoEnvValue`, so the repo-root
 * `.env` counts as "set" — NOT a bare `process.env` read. tsx does not
 * auto-load `.env`, so a bare read made the old CLIP_MOCKUP_DIR answer depend
 * on whether something earlier in the same command happened to call
 * `loadRepoEnv`, and an `update --image` wrote its frame somewhere the row's
 * reader never looked.
 */
export function getClipMockupBaseDir(): string {
  return writeFolder(readStorageRootsSync(), STORAGE_FOLDERS.clipMockups);
}

/** A Video's own frame directory, or a path inside it. */
export function getClipMockupPath(
  lineageId: string,
  relativePath?: string
): string {
  const videoDir = path.join(getClipMockupBaseDir(), lineageId);
  return relativePath === undefined
    ? videoDir
    : path.join(videoDir, relativePath);
}

/**
 * A Clip Mockup row with the ABSOLUTE paths of its two files added, as
 * `imageFile` and `audioFile`, beside the relative `imagePath` and
 * `audioPath` the row stores. An agent that wants to look at a frame reads
 * `imageFile`; it never has to know where the store is or what a lineageId
 * is. Additive on purpose: the relative fields stay exactly as they were.
 * `audioFile` is null exactly when `audioPath` is — the voice is not made yet.
 */
export function withClipMockupFiles<
  Row extends { readonly imagePath: string; readonly audioPath: string | null },
>(
  lineageId: string,
  row: Row
): Row & { readonly imageFile: string; readonly audioFile: string | null } {
  return {
    ...row,
    imageFile: locateClipMockupFileSync(lineageId, row.imagePath),
    audioFile:
      row.audioPath === null
        ? null
        : locateClipMockupFileSync(lineageId, row.audioPath),
  };
}

/**
 * Resolve a relative path inside a Video's frame directory, refusing anything
 * that escapes it or names the directory itself. Copied in shape from
 * `resolveVideoFilePath` — the containment guard is the part a caller must not
 * be able to forget.
 */
export function resolveClipMockupPath(
  lineageId: string,
  relativePath: string
): Effect.Effect<string, InvalidClipMockupPathError> {
  const root = path.resolve(getClipMockupPath(lineageId));

  if (relativePath.trim() === "") {
    return Effect.fail(
      new InvalidClipMockupPathError({
        path: relativePath,
        message: "path must not be empty",
      })
    );
  }

  if (path.isAbsolute(relativePath)) {
    return Effect.fail(
      new InvalidClipMockupPathError({
        path: relativePath,
        message: "path must be relative to the Clip Mockup directory",
      })
    );
  }

  const resolved = path.resolve(root, relativePath);

  if (resolved === root || !resolved.startsWith(root + path.sep)) {
    return Effect.fail(
      new InvalidClipMockupPathError({
        path: relativePath,
        message: "path escapes the Clip Mockup directory",
      })
    );
  }

  // The lexical check above names the error a caller sees for `..`; this
  // one also follows symlinks, so a link inside the store cannot lead out.
  if (!isUnder(root, resolved)) {
    return Effect.fail(
      new InvalidClipMockupPathError({
        path: relativePath,
        message: "path escapes the Clip Mockup directory through a symlink",
      })
    );
  }

  return Effect.succeed(resolved);
}

/** The frame's root-relative path: `clip-mockups/{lineageId}/{relativePath}`. */
const clipMockupStoragePath = (lineageId: string, relativePath: string) =>
  path.posix.join(STORAGE_FOLDERS.clipMockups, lineageId, relativePath);

/**
 * Where a stored frame is: on the first Storage Root that has it, or — when
 * none does — where it would be written (the first root). Unchecked; for
 * listing a row's files ({@link withClipMockupFiles}).
 */
const locateClipMockupFileSync = (
  lineageId: string,
  relativePath: string
): string =>
  findStoragePathSync(
    clipMockupStoragePath(lineageId, relativePath),
    readStorageRootsSync()
  ) ?? path.resolve(getClipMockupPath(lineageId, relativePath));

/**
 * {@link resolveClipMockupPath} for a frame that is READ (or deleted): the
 * same containment guard, then the first Storage Root that has the file,
 * which must itself sit inside that root's Clip Mockup directory (no symlink
 * out). Where it would be written (the first root) when no root has it.
 */
export function locateClipMockupFile(
  lineageId: string,
  relativePath: string
): Effect.Effect<string, InvalidClipMockupPathError> {
  return Effect.flatMap(
    resolveClipMockupPath(lineageId, relativePath),
    (writePath) => {
      const roots = readStorageRootsSync();
      const found = findStoragePathSync(
        clipMockupStoragePath(lineageId, relativePath),
        roots
      );
      if (found === null) return Effect.succeed(writePath);
      const inside = folderOnEveryRoot(roots, STORAGE_FOLDERS.clipMockups).some(
        (dir) => isUnder(path.join(dir, lineageId), found)
      );
      return inside
        ? Effect.succeed(found)
        : Effect.fail(
            new InvalidClipMockupPathError({
              path: relativePath,
              message:
                "path escapes the Clip Mockup directory through a symlink",
            })
          );
    }
  );
}

/**
 * Every file in a Video's Clip Mockup directory, across ALL Storage Roots,
 * as the relative paths a row stores — one directory listing per root.
 *
 * FOR THE ANIMATIC PAGE, which asks "is this file there?" of every frame and
 * every WAV on every two-second poll. Asked one file at a time
 * ({@link clipMockupFileExists}) that is a realpath, an exists per root and a
 * stat for EACH file, synchronously, and on Matt's drvfs Storage Roots every
 * one of them is a round trip to Windows: sixty Clip Mockups took longer than
 * the poll interval (#2337). A listing answers the same question for the whole
 * Video in one call per root.
 *
 * A Video directory missing on a root (not written there yet, or the drive is
 * unplugged) lists as empty. Presence only: a file listed here is still served
 * through {@link locateClipMockupFile}, whose symlink guard is unchanged.
 */
export const listClipMockupFiles = (
  lineageId: string
): Effect.Effect<ReadonlySet<string>, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const roots = yield* Effect.try(() => readStorageRootsSync()).pipe(
      Effect.orElseSucceed(() => [] as readonly string[])
    );
    const dirs = roots.map((root) =>
      path.join(root, STORAGE_FOLDERS.clipMockups, lineageId)
    );
    const listings = yield* Effect.forEach(
      dirs,
      (dir) =>
        fs
          .readDirectory(dir, { recursive: true })
          .pipe(Effect.orElseSucceed(() => [] as string[])),
      { concurrency: "unbounded" }
    );
    return new Set(
      listings.flat().map((entry) => entry.split(path.sep).join("/"))
    );
  });

/** Whether `relativePath` is in a {@link listClipMockupFiles} listing. */
export const isListedClipMockupFile = (
  listing: ReadonlySet<string>,
  relativePath: string
): boolean => listing.has(path.posix.normalize(relativePath));

/** Whether a frame already exists at `relativePath`. */
export const clipMockupFileExists = (lineageId: string, relativePath: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const full = yield* locateClipMockupFile(lineageId, relativePath);
    return yield* fs.exists(full);
  });

/** Read a stored frame or speech file back. */
export const readClipMockupFile = (lineageId: string, relativePath: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const full = yield* locateClipMockupFile(lineageId, relativePath);
    return yield* fs.readFile(full);
  });

/** Write a frame or a speech file, creating any missing parent directories. */
export const writeClipMockupFile = (
  lineageId: string,
  relativePath: string,
  content: Uint8Array
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const full = yield* resolveClipMockupPath(lineageId, relativePath);
    yield* fs.makeDirectory(path.dirname(full), { recursive: true });
    yield* fs.writeFile(full, content);
    return full;
  });

/** Delete a stored frame or speech file; one already gone is fine. */
export const removeClipMockupFile = (lineageId: string, relativePath: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const full = yield* locateClipMockupFile(lineageId, relativePath);
    yield* fs.remove(full, { force: true });
  });

/**
 * Pick the name a newly-added frame is stored under.
 *
 * Content-addressed by a random id rather than the source basename: an
 * authoring agent regenerates `frame.png` in its scratch folder over and over,
 * and two Clip Mockups that happened to share a basename would otherwise
 * silently share one picture. The extension is kept so the file is still
 * openable by double-clicking it.
 */
export function newFrameFilename(sourcePath: string): string {
  const extension = path.extname(sourcePath).toLowerCase() || ".png";
  return `${crypto.randomUUID()}${extension}`;
}

/**
 * Copy the files a duplicated Video's Clip Mockups name out of the SOURCE
 * Video's directory and into the duplicate's own.
 *
 * A duplicate is a new Video with a new `lineageId`, but the rows copied onto
 * it keep `imagePath` and `audioPath` verbatim — so without this every frame
 * and every WAV resolves into an empty directory and the duplicate's Animatic
 * plays as sixty "frame missing" cards (#1669). The Draft Version snapshot
 * path never needed it: that copies `lineageId`, so both rows point at the
 * one directory, which is why an equal pair here is a no-op.
 *
 * The caller passes the paths the COPIED rows name, which is what keeps an
 * archived Clip Mockup's frame out of it: an archived row is never copied, so
 * its files are never asked for. A path the source directory does not have is
 * skipped rather than failing the duplicate — the row was already broken, and
 * the Animatic page reports it as missing on both Videos alike.
 */
export const copyClipMockupFiles = (
  sourceLineageId: string,
  targetLineageId: string,
  relativePaths: readonly string[]
): Effect.Effect<
  number,
  InvalidClipMockupPathError | PlatformError,
  FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    if (sourceLineageId === targetLineageId) return 0;

    const fs = yield* FileSystem.FileSystem;
    let copied = 0;

    // De-duplicated: two Clip Mockups saying the same words share one WAV.
    for (const relativePath of new Set(relativePaths)) {
      const from = yield* locateClipMockupFile(sourceLineageId, relativePath);
      const to = yield* resolveClipMockupPath(targetLineageId, relativePath);

      if (!(yield* fs.exists(from))) continue;

      yield* fs.makeDirectory(path.dirname(to), { recursive: true });
      yield* fs.copyFile(from, to);
      copied++;
    }

    return copied;
  });
