import { ClipOperationsService } from "@/services/db-clip-operations.server";
import { webFileStream } from "@/services/web-file-stream.server";
import { Effect } from "effect";
import { makeLoader } from "@/services/route-action.server";
import { VideoProcessingService } from "@/services/video-processing-service";
import { clipFrame, clipSource } from "@/packages/clip-source";

export const loader = makeLoader({
  effect: ({ params }) =>
    Effect.gen(function* () {
      const clipOps = yield* ClipOperationsService;
      const clip = yield* clipOps.getClipById(params.clipId!);

      const frame = clipFrame(clipSource(clip), "first");

      const videoProcessing = yield* VideoProcessingService;

      const firstFramePath = yield* videoProcessing.getFirstFrame(
        frame.inputVideo,
        frame.time
      );

      return new Response(webFileStream(firstFramePath), {
        headers: {
          "Content-Type": "image/png",
        },
      });
    }),
});
