import { Config, ConfigError, Effect, Either } from "effect";
import {
  InvalidStorageRootsError,
  parseStorageRoots,
  STORAGE_FOLDERS,
  writeFolder,
  type StorageRoots,
} from "@/packages/storage";
import { resolveRepoEnvValue } from "./repo-env";

/**
 * The ONE place `STORAGE_ROOTS` is read. Everything that needs a Storage Root
 * — or one of the fixed folders under it, which replaced the old
 * FINISHED_VIDEOS_DIRECTORY / CLIP_MOCKUP_DIR / OVERLAY_RENDER_CACHE_DIRECTORY
 * settings — asks here.
 */
export const STORAGE_ROOTS_ENV_KEY = "STORAGE_ROOTS";

/** `STORAGE_ROOTS` as an Effect Config, parsed and validated. */
export const storageRootsConfig: Config.Config<StorageRoots> = Config.string(
  STORAGE_ROOTS_ENV_KEY
).pipe(
  Config.mapOrFail((raw) => {
    const parsed = Either.try({
      try: () => parseStorageRoots(raw),
      catch: (e) =>
        e instanceof InvalidStorageRootsError ? e.message : String(e),
    });
    return Either.mapLeft(parsed, (message) =>
      ConfigError.InvalidData([STORAGE_ROOTS_ENV_KEY], message)
    );
  })
);

/**
 * Where new Exported Videos are written: `finished-videos/` on the first
 * root. Reads look on every root (see `finished-videos.server.ts`).
 */
export const finishedVideosWriteDirectory: Effect.Effect<
  string,
  ConfigError.ConfigError
> = Effect.map(storageRootsConfig, (roots) =>
  writeFolder(roots, STORAGE_FOLDERS.finishedVideos)
);

/**
 * `STORAGE_ROOTS` for the synchronous readers (the Clip Mockup store, which
 * the `cvm` CLI reaches without an Effect runtime): an already-set
 * environment variable wins, otherwise the repo-root `.env`. Throws, naming
 * the variable, when it is unset or invalid.
 */
export const readStorageRootsSync = (): StorageRoots => {
  const raw = resolveRepoEnvValue(STORAGE_ROOTS_ENV_KEY);
  if (raw === undefined) {
    throw new InvalidStorageRootsError(
      `${STORAGE_ROOTS_ENV_KEY} is not set: add it to .env, e.g. ${STORAGE_ROOTS_ENV_KEY}=/mnt/d,/mnt/e`
    );
  }
  return parseStorageRoots(raw);
};
