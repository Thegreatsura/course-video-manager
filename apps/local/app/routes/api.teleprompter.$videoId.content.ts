/**
 * What the teleprompter puts on the glass, for one video: its title and its
 * Script. Polled every few seconds so edits made in the main window appear
 * without a reload.
 *
 * Deliberately separate from `api.videos.$videoId.script.ts`: that route also
 * resolves the full writer context, which is far too much to fetch on a loop.
 */
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { makeLoader } from "@/services/route-action.server";
import { Effect } from "effect";

export const loader = makeLoader({
  effect: ({ params }) =>
    Effect.gen(function* () {
      const videoOps = yield* VideoOperationsService;
      const video = yield* videoOps.getVideoWithLessonById(params.videoId!);
      return { title: video.title, script: video.script ?? "" };
    }),
});
