import path from "node:path";
import { Effect } from "effect";
import { FileSystem } from "@effect/platform";
import { VersionOperationsService } from "@/services/db-version-operations.server";
import { computeExportHash, toExportClips } from "@/services/export-hash";
import { SIDECAR_SUFFIX } from "@/services/export-sha256-sidecar";
import { storageRootsConfig } from "@/services/storage-roots";
import {
  assertUnderFinishedVideos,
  listFinishedVideosDirectories,
} from "@/services/finished-videos.server";
import { exportHashRenameRecorded } from "@/services/export-hash-rename";

/**
 * Garbage-collect stale exported files for a course.
 *
 * Collects all valid hashes across all versions in the DB, then deletes any
 * `{courseId}-*.mp4` files — and their `.sha256` digest sidecars — in the
 * `finished-videos/` folder of every Storage Root whose hash is not in that
 * set.
 *
 * REFUSES TO RUN (deletes nothing, returns `[]`) until the Exported Video
 * rename script has recorded that every export was renamed to its
 * root-relative Export Hash (`exportHashRenameRecorded`). Before that, every
 * finished video on disk is still named by its old, absolute-path hash, which
 * no current Video computes — so a GC in that window would delete every
 * export. See `apps/local/scripts/storage-rename-exports.ts`.
 *
 * Returns the list of deleted file paths.
 */
export const garbageCollect = (courseId: string) =>
  Effect.gen(function* () {
    const versionOps = yield* VersionOperationsService;
    const fs = yield* FileSystem.FileSystem;
    const roots = yield* storageRootsConfig;

    if (!(yield* exportHashRenameRecorded(roots))) {
      yield* Effect.logWarning(
        `export GC skipped for ${courseId}: the Exported Video rename to root-relative Export Hashes has not been recorded yet (run apps/local/scripts/storage-rename-exports.ts --apply)`
      );
      return [];
    }

    const versionsMeta = yield* versionOps.getCourseVersions(courseId);
    const allValidHashes = new Set<string>();

    for (const meta of versionsMeta) {
      const version = yield* versionOps.getVersionWithSections(meta.id);
      for (const section of version.sections) {
        for (const lesson of section.lessons) {
          for (const video of lesson.videos) {
            const hash = computeExportHash(
              toExportClips(video.clips),
              video.format,
              roots
            );
            if (hash) allValidHashes.add(hash);
          }
        }
      }
    }

    const prefix = `${courseId}-`;
    // An export and its digest sidecar share one Export Hash and one fate: the
    // sidecar describes only that file, so it is stale exactly when that file
    // is. Listed longest-first so `.mp4.sha256` is stripped before `.mp4`.
    const suffixes = [`.mp4${SIDECAR_SUFFIX}`, ".mp4"];

    const deleted: string[] = [];
    for (const { dir, files } of yield* listFinishedVideosDirectories(roots)) {
      for (const file of files) {
        if (!file.startsWith(prefix)) continue;
        const suffix = suffixes.find((s) => file.endsWith(s));
        if (!suffix) continue;
        const hash = file.slice(prefix.length, -suffix.length);
        if (allValidHashes.has(hash)) continue;
        const filePath = yield* assertUnderFinishedVideos(
          roots,
          path.join(dir, file)
        );
        yield* fs.remove(filePath);
        deleted.push(filePath);
      }
    }

    return deleted;
  });
