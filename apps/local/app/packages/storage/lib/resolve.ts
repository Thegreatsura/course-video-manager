import nodeFs from "node:fs";
import { FileSystem } from "@effect/platform";
import { Data, Effect, Option } from "effect";
import {
  rootLabel,
  rootRelativePath,
  storageCandidates,
  type StorageRoots,
} from "./storage-roots";

/**
 * A root-relative file is on no Storage Root. `offlineRoots` are the roots
 * that could not be read at all (an unplugged drive), which is the usual
 * reason; the message names them.
 */
export class StorageFileNotFoundError extends Data.TaggedError(
  "StorageFileNotFoundError"
)<{
  readonly path: string;
  readonly offlineRoots: readonly string[];
  readonly message: string;
}> {}

const notFoundMessage = (
  what: string,
  relative: string,
  offlineRoots: readonly string[]
) =>
  offlineRoots.length === 0
    ? `${what} not found on any Storage Root: ${relative}`
    : `${what} not found (${offlineRoots.map(rootLabel).join(", ")} offline?): ${relative}`;

/**
 * Where a stored path is on disk, as an Option: the first root that has it,
 * or None. An absolute path under no root is not CVM's to manage and is
 * returned as it is, whether or not it exists.
 */
export const findStoragePath = (stored: string, roots: StorageRoots) =>
  Effect.gen(function* () {
    const relative = rootRelativePath(stored, roots);
    if (relative === null) return Option.some(stored);
    const fs = yield* FileSystem.FileSystem;
    for (const candidate of storageCandidates(relative, roots)) {
      const exists = yield* fs
        .exists(candidate)
        .pipe(Effect.orElseSucceed(() => false));
      if (exists) return Option.some(candidate);
    }
    return Option.none<string>();
  });

/**
 * Where a stored path is on disk: the first Storage Root that has it. Fails
 * with {@link StorageFileNotFoundError}, naming the roots that are offline,
 * when none does. `what` names the file in that message ("Footage").
 */
export const resolveStoragePath = (
  stored: string,
  roots: StorageRoots,
  what: string
): Effect.Effect<string, StorageFileNotFoundError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const found = yield* findStoragePath(stored, roots);
    if (Option.isSome(found)) return found.value;
    const fs = yield* FileSystem.FileSystem;
    const offlineRoots: string[] = [];
    for (const root of roots) {
      const online = yield* fs
        .exists(root)
        .pipe(Effect.orElseSucceed(() => false));
      if (!online) offlineRoots.push(root);
    }
    const relative = rootRelativePath(stored, roots) ?? stored;
    return yield* new StorageFileNotFoundError({
      path: relative,
      offlineRoots,
      message: notFoundMessage(what, relative, offlineRoots),
    });
  });

/**
 * {@link findStoragePath} for the few synchronous readers (a streaming
 * route, the Clip Mockup store): the first root that has the file, or null.
 */
export const findStoragePathSync = (
  stored: string,
  roots: StorageRoots
): string | null => {
  const relative = rootRelativePath(stored, roots);
  if (relative === null) return stored;
  for (const candidate of storageCandidates(relative, roots)) {
    if (nodeFs.existsSync(candidate)) return candidate;
  }
  return null;
};
