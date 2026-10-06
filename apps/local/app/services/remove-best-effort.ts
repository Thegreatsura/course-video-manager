import type { FileSystem } from "@effect/platform";
import { Effect } from "effect";

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
