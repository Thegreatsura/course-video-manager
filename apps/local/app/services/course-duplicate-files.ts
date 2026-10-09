import path from "node:path";
import { FileSystem } from "@effect/platform";
import { Data, Effect } from "effect";
import { ClipMockupOperationsService } from "@/services/db-clip-mockup-operations.server";
import { assertUnderEffect } from "./assert-under";
import {
  getClipMockupBaseDir,
  resolveClipMockupPath,
} from "./clip-mockup-files";
import type { DuplicatedVideo } from "./clip-mockup-copy-forward.server";
import {
  getVideoFilePath,
  getVideoFilesBaseDir,
  listVideoFiles,
} from "./video-files";

/**
 * The file half of duplicating a Course, made safe to cut off and run again.
 *
 * Every Video the Course produced has a fresh `lineageId`, so its Clip
 * Mockups' frames and WAVs (#1669) and its Video Files, with them the PNGs its
 * Thumbnails name (#1674), have to be carried into the new directory. The
 * `duplicate-course` Job (`sidecar/kinds/duplicate-course.ts`) does it here:
 *
 * - each file lands under a temporary name and is renamed into place, so a
 *   file at its final path is a whole one;
 * - a file already in place at the source's size is skipped, so a resumed
 *   run copies only what the lost run had not;
 * - each copy is checked against the source's size, and once all are done
 *   every one is checked again: a file that is missing fails the Job, naming
 *   it, rather than leaving the copy quietly short.
 */

/** One file to carry: where it is, where it goes, and how big it must be. */
export interface PlannedCopy {
  /** The store it lands in: the copy is refused anywhere outside it. */
  readonly store: string;
  readonly from: string;
  readonly to: string;
  readonly size: number;
}

export class DuplicateFileCopyError extends Data.TaggedError(
  "DuplicateFileCopyError"
)<{ readonly to: string; readonly message: string }> {}

export class DuplicateFilesMissingError extends Data.TaggedError(
  "DuplicateFilesMissingError"
)<{ readonly missing: readonly string[]; readonly message: string }> {}

const sizeOf = (file: string) =>
  Effect.flatMap(FileSystem.FileSystem, (fs) =>
    fs.stat(file).pipe(
      Effect.map((info) => Number(info.size)),
      // Gone (or never there) reads as no size at all.
      Effect.orElseSucceed(() => null)
    )
  );

/**
 * Every file one duplicated Video needs: the frames and WAVs its own Clip
 * Mockup rows name (an archived row was never copied, so its files are never
 * asked for), then every Video File under the source's directory. A Clip
 * Mockup file the source does not have is left out, as before: the row was
 * already broken, and the Animatic reports it missing on both Videos.
 */
export const planDuplicatedVideoFiles = Effect.fn("planDuplicatedVideoFiles")(
  function* (video: DuplicatedVideo) {
    if (video.sourceLineageId === video.newLineageId) return [];
    const clipMockupOps = yield* ClipMockupOperationsService;
    const rows = yield* clipMockupOps.listClipMockupsByVideoId(
      video.newVideoId
    );
    const planned: PlannedCopy[] = [];
    // De-duplicated: two Clip Mockups saying the same words share one WAV.
    const mockupPaths = new Set(
      rows.flatMap((row) => [row.imagePath, row.audioPath])
    );
    for (const relativePath of mockupPaths) {
      const from = yield* resolveClipMockupPath(
        video.sourceLineageId,
        relativePath
      );
      const size = yield* sizeOf(from);
      if (size === null) continue;
      const to = yield* resolveClipMockupPath(video.newLineageId, relativePath);
      planned.push({ store: getClipMockupBaseDir(), from, to, size });
    }
    for (const entry of yield* listVideoFiles(video.sourceLineageId)) {
      planned.push({
        store: getVideoFilesBaseDir(),
        from: getVideoFilePath(video.sourceLineageId, entry.path),
        to: getVideoFilePath(video.newLineageId, entry.path),
        size: entry.size,
      });
    }
    return planned;
  }
);

/** Whether the file is in place: present, at the size it was planned at. */
const isInPlace = (copy: PlannedCopy) =>
  Effect.map(sizeOf(copy.to), (size) => size === copy.size);

/**
 * Copy one file, unless it is already in place. Answers `copied` or
 * `skipped`; fails if the file it wrote is not the source's size.
 */
export const copyPlannedFile = (copy: PlannedCopy) =>
  Effect.gen(function* () {
    if (yield* isInPlace(copy)) return "skipped" as const;
    const fs = yield* FileSystem.FileSystem;
    yield* fs.makeDirectory(path.dirname(copy.to), { recursive: true });
    const to = yield* assertUnderEffect(copy.store, copy.to);
    const partial = yield* assertUnderEffect(copy.store, `${copy.to}.partial`);
    yield* fs.copyFile(copy.from, partial);
    yield* fs.rename(partial, to);
    const size = yield* sizeOf(copy.to);
    if (size !== copy.size) {
      return yield* new DuplicateFileCopyError({
        to: copy.to,
        message: `copied ${copy.from} to ${copy.to}, but it is ${size ?? "missing"} bytes, not ${copy.size}`,
      });
    }
    return "copied" as const;
  });

/** Check every planned file is in place; fail naming each one that is not. */
export const verifyPlannedFiles = (copies: readonly PlannedCopy[]) =>
  Effect.gen(function* () {
    const missing: string[] = [];
    for (const copy of copies) {
      if (!(yield* isInPlace(copy))) missing.push(copy.to);
    }
    if (missing.length > 0) {
      return yield* new DuplicateFilesMissingError({
        missing,
        message: `${missing.length} of ${copies.length} files did not reach the copy: ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? ", …" : ""}`,
      });
    }
  });
