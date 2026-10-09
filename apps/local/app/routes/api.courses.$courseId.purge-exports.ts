import { Config, Effect, Schema } from "effect";
import { assertUnderEffect } from "@/services/assert-under";
import { FileSystem } from "@effect/platform";
import { VersionOperationsService } from "@/services/db-version-operations.server";
import { makeAction } from "@/services/route-action.server";
import { CoursePublishReadService } from "@/services/course-publish-reads";

const purgeExportsSchema = Schema.Struct({
  versionId: Schema.String.pipe(Schema.minLength(1)),
});

export const action = makeAction({
  input: "formData",
  effect: ({ payload }) =>
    Effect.gen(function* () {
      const { versionId } =
        yield* Schema.decodeUnknown(purgeExportsSchema)(payload);

      const versionOps = yield* VersionOperationsService;
      const fs = yield* FileSystem.FileSystem;
      const publishService = yield* CoursePublishReadService;

      const videoIds = yield* versionOps.getVideoIdsForVersion(versionId);
      const finishedVideosDir = yield* Config.string(
        "FINISHED_VIDEOS_DIRECTORY"
      );

      let deletedCount = 0;
      for (const videoId of videoIds) {
        const exportPath = yield* publishService.resolveExportPath(videoId);
        if (!exportPath) continue;
        const videoPath = yield* assertUnderEffect(
          finishedVideosDir,
          exportPath
        );
        const exists = yield* fs.exists(videoPath);
        if (exists) {
          yield* fs.remove(videoPath);
          deletedCount++;
        }
      }

      return { success: true, deletedCount, totalVideos: videoIds.length };
    }).pipe(
      Effect.catchAll((error) =>
        Effect.succeed({
          success: false,
          error: `Failed to purge exports: ${error}`,
        })
      )
    ),
});
