import { Data, Effect } from "effect";
import { clips, recordingSessions } from "@cvm/core/db/schema";
import { listVideosForExportHash } from "@cvm/core/services/db-export-hash-videos.server";
import type { Database } from "@cvm/core/services/drizzle-service.server";
import { computeExportHash, toExportClips } from "@/services/export-hash";
import {
  assignStorageBuckets,
  type StorageOwnership,
  type StorageOwnershipInput,
} from "./buckets";

/** Loading what owns which file failed; the scan cannot start. */
export class StorageOwnershipLoadError extends Data.TaggedError(
  "StorageOwnershipLoadError"
)<{ readonly message: string }> {}

/**
 * What the database says owns each file: every Course, every Video (in any
 * Version, archived or not) with the names of its current Exported Video,
 * and every Footage path any Clip (archived ones too: they can come back) or
 * Recording Session uses. Read-only.
 */
export const loadStorageOwnership = (
  db: Database,
  roots: readonly string[]
): Effect.Effect<StorageOwnership, StorageOwnershipLoadError> =>
  Effect.tryPromise({
    try: async () => {
      const [courses, videos, clipRows, sessionRows] = await Promise.all([
        db.query.courses.findMany({ columns: { id: true, name: true } }),
        listVideosForExportHash(db),
        db
          .select({
            videoId: clips.videoId,
            stored: clips.videoFilename,
            recordingSessionId: clips.recordingSessionId,
          })
          .from(clips),
        db
          .select({
            id: recordingSessions.id,
            videoId: recordingSessions.videoId,
            camera: recordingSessions.cameraFilePath,
            screen: recordingSessions.screenFilePath,
            mic: recordingSessions.micFilePath,
          })
          .from(recordingSessions),
      ]);

      const footageUses: { stored: string; videoId: string | null }[] = [];
      const sessionFiles = new Map(
        sessionRows.map((s) => [s.id, [s.camera, s.screen, s.mic]] as const)
      );
      const sessionsWithClips = new Set<string>();
      for (const clip of clipRows) {
        footageUses.push({ stored: clip.stored, videoId: clip.videoId });
        if (clip.recordingSessionId === null) continue;
        sessionsWithClips.add(clip.recordingSessionId);
        for (const stored of sessionFiles.get(clip.recordingSessionId) ?? []) {
          footageUses.push({ stored, videoId: clip.videoId });
        }
      }
      // A Recording Session no Clip points at still uses its files.
      for (const session of sessionRows) {
        if (sessionsWithClips.has(session.id)) continue;
        for (const stored of [session.camera, session.screen, session.mic]) {
          footageUses.push({ stored, videoId: session.videoId });
        }
      }

      const input: StorageOwnershipInput = {
        courses,
        videos: videos.map((video) => {
          const hash = computeExportHash(
            toExportClips(video.clips),
            video.format,
            roots
          );
          const names = [`${video.id}.mp4`];
          if (hash) names.push(`${video.courseId ?? video.id}-${hash}.mp4`);
          return {
            id: video.id,
            courseId: video.courseId,
            format: video.format,
            exportNames: names,
          };
        }),
        footageUses,
      };
      return assignStorageBuckets(input, roots);
    },
    catch: (cause) =>
      new StorageOwnershipLoadError({
        message: `Could not read what owns each file: ${cause instanceof Error ? cause.message : String(cause)}`,
      }),
  });
