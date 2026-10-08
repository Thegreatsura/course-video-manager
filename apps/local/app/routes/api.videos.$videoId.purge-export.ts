import { Config, Effect } from "effect";
import { assertUnderEffect } from "@/services/assert-under";
import { FileSystem } from "@effect/platform";
import { data } from "react-router";
import { CoursePublishService } from "@/services/course-publish-service";
import { makeAction } from "@/services/route-action.server";

export const action = makeAction({
  effect: ({ params }) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const publishService = yield* CoursePublishService;
      const exportPath = yield* publishService.resolveExportPath(
        params.videoId!
      );

      if (!exportPath) {
        return yield* Effect.die(data("File not found", { status: 404 }));
      }

      const videoPath = yield* assertUnderEffect(
        yield* Config.string("FINISHED_VIDEOS_DIRECTORY"),
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
