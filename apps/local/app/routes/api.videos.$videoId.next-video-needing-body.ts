import { Effect } from "effect";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { makeLoader } from "@/services/route-action.server";

/**
 * The Lesson Body writer's "More?": the next Video after this one, in course
 * order, whose Lesson Body is empty and which has Clips. `null` when none is
 * left.
 */
export const loader = makeLoader({
  effect: ({ params }) =>
    Effect.gen(function* () {
      const videoOps = yield* VideoOperationsService;
      const nextVideoId = yield* videoOps.getNextVideoNeedingBody(
        params.videoId!
      );
      return { nextVideoId };
    }),
});
