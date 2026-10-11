import { ClipOperationsService } from "@/services/db-clip-operations.server";
import { webFileStream } from "@/services/web-file-stream.server";
import { Effect } from "effect";
import { makeLoader } from "@/services/route-action.server";
import { VideoProcessingService } from "@/services/video-processing-service";
import { clipFrame, clipSource } from "@/packages/clip-source";
import { stillSceneOverride } from "@/features/video-editor/clip-still-url";

export const loader = makeLoader({
  effect: ({ params, request }) =>
    Effect.gen(function* () {
      const clipOps = yield* ClipOperationsService;
      const clip = yield* clipOps.getClipWithRecordingSession(params.clipId!);

      const videoProcessing = yield* VideoProcessingService;

      const firstFramePath = yield* videoProcessing.getFirstFrame(
        clipFrame(
          clipSource({
            ...clip,
            sceneOverride: stillSceneOverride(request.url, clip.sceneOverride),
          }),
          "first"
        )
      );

      return new Response(webFileStream(firstFramePath), {
        headers: {
          "Content-Type": "image/png",
        },
      });
    }),
});
