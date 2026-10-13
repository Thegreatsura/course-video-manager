import { Effect } from "effect";
import {
  clipSource,
  mapClipFrameFiles,
  mapClipSourceFiles,
  type ClipFrame,
  type ClipSource,
  type ClipSourceRow,
} from "@/packages/clip-source";
import type { StorageRoots } from "@/packages/storage";
import { resolveStoragePath } from "@/packages/storage/server";

/**
 * A Clip Source with its files found on disk: each stored path (root-relative,
 * or a legacy absolute path under a root) is looked for on each Storage Root
 * in order, the first that has it winning. A path under no root (a Recording
 * Session in `~/Videos`) is used as it is.
 *
 * Fails with `StorageFileNotFoundError` — "Footage not found (E: offline?)" —
 * when a file is on no root. For ffmpeg only: hash the stored source, never
 * this one.
 */
export const resolveClipSourceFiles = (
  source: ClipSource,
  roots: StorageRoots
) =>
  mapClipSourceFiles(source, (file) =>
    resolveStoragePath(file, roots, "Footage")
  );

/** {@link resolveClipSourceFiles} for one still of a Clip. */
export const resolveClipFrameFiles = (frame: ClipFrame, roots: StorageRoots) =>
  mapClipFrameFiles(frame, (file) =>
    resolveStoragePath(file, roots, "Footage")
  );

/** What the editor shows in place of a Clip's player. */
export type FootageNotFound = {
  /** "Footage not found (E: offline?)" */
  readonly headline: string;
  /** The root-relative path that was looked for. */
  readonly path: string;
};

/**
 * The Clips whose Footage is on no Storage Root, by Clip id, each with what
 * the editor shows in place of its player: "Footage not found (E:
 * offline?)" and the path. Only reads: a Clip missing here is never
 * changed, archived or re-exported because of it.
 */
export const findClipsWithMissingFootage = (
  clips: readonly (ClipSourceRow & { readonly id: string })[],
  roots: StorageRoots
) =>
  Effect.forEach(
    clips,
    (clip) =>
      resolveClipSourceFiles(clipSource(clip), roots).pipe(
        Effect.match({
          onSuccess: () => [] as [string, FootageNotFound][],
          onFailure: (error): [string, FootageNotFound][] => [
            [
              clip.id,
              {
                headline: error.message.endsWith(`: ${error.path}`)
                  ? error.message.slice(0, -`: ${error.path}`.length)
                  : error.message,
                path: error.path,
              },
            ],
          ],
        })
      ),
    { concurrency: 8 }
  ).pipe(
    Effect.map((found): Record<string, FootageNotFound> =>
      Object.fromEntries(found.flat())
    )
  );
