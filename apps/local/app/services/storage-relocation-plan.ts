import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import path from "node:path";
import { FileSystem } from "@effect/platform";
import { Data, Effect } from "effect";
import { rootRelativePath, type StorageRoots } from "@/packages/storage";

/**
 * The plan of the one-off relocation (#2105) and the file helpers its
 * planning and applying share. See `storage-relocation.server.ts`.
 */

/** One file to copy: where it is now, and where it goes on the first root. */
export type PlannedFileCopy = {
  readonly from: string;
  readonly to: string;
  /** The folder on the first root it must stay inside. */
  readonly store: string;
};

/** One stored path to rewrite. */
export type PlannedRowRewrite = {
  readonly row: string;
  readonly from: string;
  readonly to: string;
};

export type PlannedExportRename = {
  readonly from: string;
  readonly to: string;
};

export type RelocationPlan = {
  readonly copies: readonly PlannedFileCopy[];
  readonly rows: readonly PlannedRowRewrite[];
  readonly exportRenames: readonly PlannedExportRename[];
  /** Folders and files removed once the rows are committed. */
  readonly originals: readonly string[];
  /** A row naming a file that is nowhere: listed, left as it is. */
  readonly missing: readonly string[];
  /** A legacy Video File whose path already holds a different file on a root. */
  readonly shadowed: readonly string[];
  /** Any one of these refuses the whole relocation. */
  readonly problems: readonly string[];
  /** The rewrites, per table, as `applyRelocation` performs them. */
  readonly updates: RowUpdates;
};

export type RowUpdates = {
  readonly sessions: ReadonlyArray<{
    id: string;
    cameraFilePath: string;
    screenFilePath: string;
    micFilePath: string;
  }>;
  readonly clips: ReadonlyArray<{ id: string; videoFilename: string }>;
  readonly videos: ReadonlyArray<{ id: string; originalFootagePath: string }>;
  readonly calibrations: ReadonlyArray<{
    id: string;
    micFilePath: string;
    browserTracePath: string;
    cameraFilePath: string | null;
  }>;
  readonly thumbnails: ReadonlyArray<{
    id: string;
    filePath: string | null;
    layers: unknown;
  }>;
};

export class RelocationAbortedError extends Data.TaggedError(
  "RelocationAbortedError"
)<{ readonly message: string }> {}

export const posix = path.posix;

/** Whether a stored path is absolute and on no Storage Root. */
export const underNoRoot = (stored: string, roots: StorageRoots) =>
  posix.isAbsolute(stored) && rootRelativePath(stored, roots) === null;

export const isInside = (dir: string, file: string) =>
  file.startsWith(`${dir}/`) && file.length > dir.length + 1;

/** Every file under a folder, recursively, as paths relative to it. */
export const walkFiles = (
  dir: string
): Effect.Effect<string[], never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const names = yield* fs
      .readDirectory(dir)
      .pipe(Effect.orElseSucceed(() => [] as string[]));
    const files: string[] = [];
    for (const name of names.sort()) {
      const full = path.join(dir, name);
      const info = yield* fs.stat(full).pipe(Effect.option);
      if (info._tag === "None") continue;
      if (info.value.type === "Directory") {
        for (const inner of yield* walkFiles(full))
          files.push(posix.join(name, inner));
      } else if (info.value.type === "File") {
        files.push(name);
      }
    }
    return files;
  });

export const existsOn = (file: string) =>
  Effect.flatMap(FileSystem.FileSystem, (fs) =>
    fs.exists(file).pipe(Effect.orElseSucceed(() => false))
  );

class FileReadError extends Data.TaggedError("FileReadError")<{
  readonly message: string;
}> {}

/** A file's size and SHA-256: what "the same file" means here. */
export const fingerprint = (file: string) =>
  Effect.tryPromise({
    try: () =>
      new Promise<string>((resolve, reject) => {
        const hash = createHash("sha256");
        let size = 0;
        createReadStream(file)
          .on("data", (chunk) => {
            size += chunk.length;
            hash.update(chunk);
          })
          .on("error", reject)
          .on("end", () => resolve(`${size}:${hash.digest("hex")}`));
      }),
    catch: (e) =>
      new FileReadError({
        message: `could not read ${file}: ${e instanceof Error ? e.message : String(e)}`,
      }),
  });

/** Every `filePath` string anywhere in a Thumbnail's `layers` JSON. */
export const layerPaths = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.flatMap(layerPaths);
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, item]) =>
    key === "filePath" && typeof item === "string" ? [item] : layerPaths(item)
  );
};

export const rewriteLayerPaths = (
  value: unknown,
  rewrite: (p: string) => string
): unknown => {
  if (Array.isArray(value))
    return value.map((item) => rewriteLayerPaths(item, rewrite));
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      key === "filePath" && typeof item === "string"
        ? rewrite(item)
        : rewriteLayerPaths(item, rewrite),
    ])
  );
};

/** Read the database, failing as the relocation's own error. */
export const dbRead = <A>(read: () => Promise<A>) =>
  Effect.tryPromise({
    try: read,
    catch: (e) =>
      new RelocationAbortedError({
        message: `Reading the database failed: ${e instanceof Error ? e.message : String(e)}`,
      }),
  });
