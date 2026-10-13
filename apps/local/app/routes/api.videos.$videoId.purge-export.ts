import { Effect } from "effect";
import { assertUnderFinishedVideos } from "@/services/finished-videos.server";
import { storageRootsConfig } from "@/services/storage-roots";
import { FileSystem } from "@effect/platform";
import { data } from "react-router";
import { CoursePublishReadService } from "@/services/course-publish-reads";
import { makeAction } from "@/services/route-action.server";

export const action = makeAction({
  effect: ({ params }) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const publishService = yield* CoursePublishReadService;
      const exportPath = yield* publishService.resolveExportPath(
        params.videoId!
      );

      if (!exportPath) {
        return yield* Effect.die(data("File not found", { status: 404 }));
      }

      const videoPath = yield* assertUnderFinishedVideos(
        yield* storageRootsConfig,
        exportPath
      );

      const fileExists = yield* fs.exists(videoPath);
      if (!fileExists) {
        return yield* Effect.die(data("File not found", { status: 404 }));
      }

      yield* fs.remove(videoPath);

      return { success: true };
    }),
});
