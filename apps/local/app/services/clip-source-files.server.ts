import {
  mapClipFrameFiles,
  mapClipSourceFiles,
  type ClipFrame,
  type ClipSource,
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
