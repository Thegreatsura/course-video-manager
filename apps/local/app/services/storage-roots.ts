import { statSync } from "node:fs";
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

/**
 * The startup check on `STORAGE_ROOTS`, run by the app server and the Sidecar
 * before anything is built: `refusal` names the variable when it is missing
 * or invalid (the process must not start), and `offline` lists the roots that
 * are not there right now (an unplugged drive: a warning, not a refusal —
 * files on the other roots still work).
 */
export const judgeStorageRoots = (
  env: Readonly<Record<string, string | undefined>>,
  isDirectory: (root: string) => boolean
): { refusal: string | undefined; offline: string[] } => {
  const raw = env[STORAGE_ROOTS_ENV_KEY];
  if (raw === undefined || raw.trim() === "") {
    return {
      refusal: `${STORAGE_ROOTS_ENV_KEY} is not set. Add it to .env — the drives CVM's files are on, in order, e.g. ${STORAGE_ROOTS_ENV_KEY}=/mnt/d (see .env.example and ADR 0040).`,
      offline: [],
    };
  }
  let roots: StorageRoots;
  try {
    roots = parseStorageRoots(raw);
  } catch (e) {
    return {
      refusal: e instanceof Error ? e.message : String(e),
      offline: [],
    };
  }
  return {
    refusal: undefined,
    offline: roots.filter((root) => !isDirectory(root)),
  };
};

const isDirectorySync = (root: string): boolean => {
  try {
    return statSync(root).isDirectory();
  } catch {
    return false;
  }
};

/**
 * {@link judgeStorageRoots} for the app server: throws on a refusal, so the
 * server does not start; warns, naming each offline root.
 */
export const assertStorageRoots = (
  env: Readonly<Record<string, string | undefined>>
): void => {
  const { refusal, offline } = judgeStorageRoots(env, isDirectorySync);
  if (refusal !== undefined) throw new InvalidStorageRootsError(refusal);
  for (const root of offline) {
    console.warn(
      `[storage] Storage Root ${root} is offline (not mounted or not a directory): files on it will be "not found" until it is back.`
    );
  }
};

/** {@link judgeStorageRoots} with the real filesystem, for the Sidecar. */
export const judgeStorageRootsOnDisk = (
  env: Readonly<Record<string, string | undefined>>
) => judgeStorageRoots(env, isDirectorySync);
