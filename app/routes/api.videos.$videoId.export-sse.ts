import { Effect } from "effect";
import { DBFunctionsService } from "@/services/db-service";
import { runtimeLive } from "@/services/layer";
import type { Route } from "./+types/api.videos.$videoId.export-sse";
import {
  VideoProcessingService,
  type BeatType,
} from "@/services/video-processing-service";
import { FINAL_VIDEO_PADDING } from "@/features/video-editor/constants";

export const action = async (args: Route.ActionArgs) => {
  const { videoId } = args.params;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const sendEvent = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        );
      };

      const program = Effect.gen(function* () {
        const db = yield* DBFunctionsService;
        const videoProcessing = yield* VideoProcessingService;

        const video = yield* db.getVideoWithClipsById(videoId);
        const clips = video.clips;

        yield* videoProcessing.exportVideoClips({
          videoId,
          shortsDirectoryOutputName: undefined,
          clips: clips.map((clip, index, array) => {
            const isFinalClip = index === array.length - 1;
            return {
              inputVideo: clip.videoFilename,
              startTime: clip.sourceStartTime,
              duration:
                clip.sourceEndTime -
                clip.sourceStartTime +
                (isFinalClip ? FINAL_VIDEO_PADDING : 0),
              beatType: clip.beatType as BeatType,
            };
          }),
          onStageChange: (stage) => {
            sendEvent("stage", { stage });
          },
        });

        sendEvent("complete", {});
      });

      program
        .pipe(
          Effect.catchTag("NotFoundError", () =>
            Effect.sync(() => {
              sendEvent("error", { message: "Video not found" });
            })
          ),
          Effect.catchAll((e) =>
            Effect.sync(() => {
              sendEvent("error", {
                message:
                  "message" in e && typeof e.message === "string"
                    ? e.message
                    : "Export failed unexpectedly",
              });
            })
          ),
          runtimeLive.runPromise
        )
        .finally(() => {
          controller.close();
        });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
};
