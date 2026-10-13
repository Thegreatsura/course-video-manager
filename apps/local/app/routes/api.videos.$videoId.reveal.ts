import { Effect } from "effect";
import { data } from "react-router";
import { CoursePublishReadService } from "@/services/course-publish-reads";
import { makeAction } from "@/services/route-action.server";
import { revealFileInExplorer } from "@/services/open-folder-service";

export const action = makeAction({
  effect: ({ params }) =>
    Effect.gen(function* () {
      const publishService = yield* CoursePublishReadService;
      const exportPath = yield* publishService.resolveExportPath(
        params.videoId!
      );

      if (!exportPath) {
        return yield* Effect.die(
          data("No exported file for this video", { status: 404 })
        );
      }

      yield* revealFileInExplorer(exportPath);

      return { success: true };
    }),
});
