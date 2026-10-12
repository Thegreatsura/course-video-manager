import { Console, Effect } from "effect";
import type { Route } from "./+types/videos.$videoId.export-to-davinci-resolve";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { VersionOperationsService } from "@/services/db-version-operations.server";
import { VideoProcessingService } from "@/services/video-processing-service";
import { clipFfmpegInput, clipSource } from "@/packages/clip-source";
import { runtimeLive } from "@/services/layer.server";
import { runRouteEffect } from "@/services/route-action.server";
import { data } from "react-router";
import { davinciResolveRefusal } from "@cvm/core/features/videos/recorder";

export const action = async (args: Route.ActionArgs) => {
  return Effect.gen(function* () {
    const videoOps = yield* VideoOperationsService;
    const versionOps = yield* VersionOperationsService;
    const videoProcessing = yield* VideoProcessingService;
    const { videoId } = args.params;

    const video = yield* videoOps.getVideoWithClipsById(videoId, {
      withArchived: false,
    });

    // OBS-only: the editor hides it on a New recorder Video (#2011).
    const refusal = davinciResolveRefusal(video);
    if (refusal) {
      return yield* Effect.die(data(refusal, { status: 409 }));
    }

    const videoName = video.lesson
      ? [yield* versionOps.resolveLessonDir(video.lesson.id), video.title].join(
          " - "
        )
      : video.title;

    const clips = video.clips;

    const output = yield* videoProcessing.sendClipsToDavinciResolve({
      clips: clips.map((clip) => clipFfmpegInput(clipSource(clip))),
      timelineName: videoName,
    });

    yield* Console.log(output);

    return {
      success: true,
    };
  }).pipe(
    Effect.tapErrorCause((e) => Console.dir(e, { depth: null })),
    Effect.catchTag("NotFoundError", () => {
      return Effect.die(data("Video not found", { status: 404 }));
    }),
    Effect.catchAll(() => {
      return Effect.die(data("Internal server error", { status: 500 }));
    }),
    (effect) => runRouteEffect(runtimeLive, effect)
  );
};
