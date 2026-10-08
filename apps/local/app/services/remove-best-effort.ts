import type { FileSystem } from "@effect/platform";
import { Effect } from "effect";
import { assertUnderEffect } from "./assert-under";

/**
 * Remove a scratch file or a file being replaced, without failing the work
 * around it. Cleanup is best-effort: a leftover temp file must never fail the
 * export, transcription or upload that made it.
 *
 * A file that is already gone is the goal reached, so it is silent. Any other
 * failure (permissions, a locked file on Windows) is logged as a warning
 * rather than swallowed, so a leak of files on disk has a trail.
 */
export const removeBestEffort = (
  fs: FileSystem.FileSystem,
  path: string
): Effect.Effect<void> =>
  fs
    .remove(path)
    .pipe(
      Effect.catchAll((error) =>
        error._tag === "SystemError" && error.reason === "NotFound"
          ? Effect.void
          : Effect.logWarning(`Could not remove ${path}`).pipe(
              Effect.annotateLogs("error", error.message)
            )
      )
    );

/**
 * `removeBestEffort` for a path the app did not build itself (a `filePath`
 * read from a row, a path out of a request). The path must lie under
 * `baseDir` — see `assertUnder`. One that does not is left alone with a
 * warning: on a verify-cvm clone a row still names Matt's real file, and
 * cleanup must never reach it.
 */
export const removeUnderBestEffort = (
  fs: FileSystem.FileSystem,
  baseDir: string,
  path: string
): Effect.Effect<void> =>
  assertUnderEffect(baseDir, path).pipe(
    Effect.flatMap((guarded) => removeBestEffort(fs, guarded)),
    Effect.catchTag("PathOutsideBaseDirError", (error) =>
      Effect.logWarning(`Not removing ${path}`).pipe(
        Effect.annotateLogs("error", error.message)
      )
    )
  );
