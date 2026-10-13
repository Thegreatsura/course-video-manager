import path from "node:path";
import { Effect } from "effect";
import { listVideosForExportHash } from "@cvm/core/services/db-export-hash-videos.server";
import type { StorageRoots } from "@/packages/storage";
import type { Database } from "@/services/drizzle-service.server";
import { computeExportHash, toExportClips } from "./export-hash";
import { exportHashRenameRecorded } from "./export-hash-rename";
import { SIDECAR_SUFFIX } from "./export-sha256-sidecar";
import { listFinishedVideosDirectories } from "./finished-videos.server";
import {
  dbRead,
  type PlannedExportRename,
  type RowUpdates,
} from "./storage-relocation-plan";

/**
 * Moving a Recording Session changes its Clips' Export Hash (the hash names
 * Footage by its root-relative path, ADR 0040). For each Video it changes,
 * plan renaming its Exported Video (and `.sha256` digest) from the old
 * address to the new one, rather than re-encoding it.
 *
 * Refused (a problem) while the exports are still named by the old,
 * absolute-path hash: `storage:rename-exports` (#2104) must run first, or
 * this would look for names that are not there.
 */
export const planExportRenames = (
  db: Database,
  o: {
    readonly roots: StorageRoots;
    readonly sessions: RowUpdates["sessions"];
    readonly clips: RowUpdates["clips"];
  }
) =>
  Effect.gen(function* () {
    const { roots } = o;
    const renames: PlannedExportRename[] = [];
    const problems: string[] = [];
    if (o.clips.length > 0 || o.sessions.length > 0) {
      const newSession = new Map(o.sessions.map((s) => [s.id, s]));
      const newFilename = new Map(o.clips.map((c) => [c.id, c.videoFilename]));
      const listing = yield* listFinishedVideosDirectories(roots).pipe(
        Effect.orElseSucceed(() => [] as { dir: string; files: string[] }[])
      );
      const everyExport = new Set(listing.flatMap(({ files }) => files));
      const allVideos = yield* dbRead(() => listVideosForExportHash(db));
      // `listVideosForExportHash` loads Clips without ids; match by position.
      const clipIdsByVideo = new Map<string, string[]>();
      for (const v of yield* dbRead(() =>
        db.query.videos.findMany({
          columns: { id: true },
          with: {
            clips: {
              columns: { id: true },
              orderBy: (c, { asc }) => asc(c.order),
              where: (c, { eq: equals }) => equals(c.archived, false),
            },
          },
        })
      )) {
        clipIdsByVideo.set(
          v.id,
          v.clips.map((c) => c.id)
        );
      }
      let needsRenamedExports = false;
      for (const video of allVideos) {
        const ids = clipIdsByVideo.get(video.id) ?? [];
        let touched = false;
        const after = video.clips.map((clip, i) => {
          const filename = newFilename.get(ids[i] ?? "");
          const session = clip.recordingSession
            ? newSession.get(clip.recordingSession.id)
            : undefined;
          if (filename === undefined && session === undefined) return clip;
          touched = true;
          return {
            ...clip,
            videoFilename: filename ?? clip.videoFilename,
            recordingSession:
              clip.recordingSession && session
                ? {
                    ...clip.recordingSession,
                    cameraFilePath: session.cameraFilePath,
                    screenFilePath: session.screenFilePath,
                    micFilePath: session.micFilePath,
                  }
                : clip.recordingSession,
          };
        });
        if (!touched) continue;
        const oldHash = computeExportHash(
          toExportClips(video.clips),
          video.format,
          roots
        );
        const newHash = computeExportHash(
          toExportClips(after),
          video.format,
          roots
        );
        if (!oldHash || !newHash || oldHash === newHash) continue;
        needsRenamedExports = true;
        const namespace = video.courseId ?? video.id;
        const oldName = `${namespace}-${oldHash}.mp4`;
        const newName = `${namespace}-${newHash}.mp4`;
        for (const { dir, files } of listing) {
          if (!files.includes(oldName)) continue;
          if (everyExport.has(newName)) {
            problems.push(
              `${path.join(dir, oldName)} would be renamed to ${newName}, which already exists in a finished-videos/ folder. Keep one of the two by hand and re-run.`
            );
            continue;
          }
          renames.push({
            from: path.join(dir, oldName),
            to: path.join(dir, newName),
          });
          if (files.includes(`${oldName}${SIDECAR_SUFFIX}`)) {
            renames.push({
              from: path.join(dir, `${oldName}${SIDECAR_SUFFIX}`),
              to: path.join(dir, `${newName}${SIDECAR_SUFFIX}`),
            });
          }
        }
      }
      if (needsRenamedExports && !(yield* exportHashRenameRecorded(roots))) {
        problems.push(
          "Exported Videos are still named by the old, absolute-path Export Hash: run `pnpm storage:rename-exports --apply` (#2104) first, then this."
        );
      }
    }

    return { renames, problems };
  });
