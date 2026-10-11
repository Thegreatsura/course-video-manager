import { ClipOperationsService } from "@/services/db-clip-operations.server";
import { webFileStream } from "@/services/web-file-stream.server";
import { Effect } from "effect";
import { eq } from "drizzle-orm";
import { recordingSessions } from "@/db/schema";
import { dbCall } from "@/services/clip-service-handler.helpers";
import { DrizzleService } from "@/services/drizzle-service.server";
import { makeLoader } from "@/services/route-action.server";
import { VideoProcessingService } from "@/services/video-processing-service";
import { clipFrame, clipSource } from "@/packages/clip-source";

export const loader = makeLoader({
  effect: ({ params }) =>
    Effect.gen(function* () {
      const clipOps = yield* ClipOperationsService;
      const clip = yield* clipOps.getClipById(params.clipId!);

      const frame = clipFrame(clipSource(clip), "last");

      // A new-recorder Clip's Footage path is its mic file: until its stills
      // are composited (#2007), its last frame is the raw camera's, which
      // shares the picture's clock.
      const db = yield* DrizzleService;
      const session = clip.recordingSessionId
        ? yield* dbCall(() =>
            db.query.recordingSessions.findFirst({
              where: eq(recordingSessions.id, clip.recordingSessionId!),
            })
          )
        : undefined;
      const inputVideo = session?.cameraFilePath ?? frame.inputVideo;

      const videoProcessing = yield* VideoProcessingService;

      const lastFramePath = yield* videoProcessing.getLastFrame(
        inputVideo,
        frame.time
      );

      return new Response(webFileStream(lastFramePath), {
        headers: {
          "Content-Type": "image/png",
        },
      });
    }),
});
