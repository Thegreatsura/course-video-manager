import { Effect } from "effect";
import { CoursePublishService } from "@/services/course-publish-service";
import { makeLoader } from "@/services/route-action.server";

export const loader = makeLoader({
  effect: ({ params }) => {
    const videoId = params.videoId!;

    return Effect.gen(function* () {
      const publishService = yield* CoursePublishService;
      const exists = yield* publishService.isExported(videoId);
      return Response.json({ exists });
    }).pipe(
      Effect.catchAll(() => {
        return Effect.succeed(Response.json({ exists: false }));
      })
    );
  },
});
