import { Effect } from "effect";
import {
  resolveVideoFormat,
  type VideoFormat,
} from "@/features/videos/video-format";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { recorderClient } from "@/services/recorder-client/live.server";
import { makeLoader } from "@/services/route-action.server";

/**
 * The editor's subscription to a CVM recorder Video's Recording Sessions
 * (`CvmRecorderMessage`, one SSE event each, named by its `type`). It only
 * listens: closing it stops nothing, because the recorder service and the
 * app server's recorder client record and save whether anyone listens.
 * Listening opens the recorder in the Video's format (a Short wakes Spacedesk).
 */
export const loader = makeLoader({
  effect: ({ params, request }) =>
    Effect.gen(function* () {
      const videoId = params.videoId!;
      const video = yield* (yield* VideoOperationsService).getVideoRowById(
        videoId
      );
      return eventStream(videoId, resolveVideoFormat(video.format), request);
    }),
});

const eventStream = (
  videoId: string,
  format: VideoFormat,
  request: Request
) => {
  const encoder = new TextEncoder();
  let unsubscribe = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      unsubscribe = recorderClient().subscribe(
        videoId,
        (message) => {
          controller.enqueue(
            encoder.encode(
              `event: ${message.type}\ndata: ${JSON.stringify(message)}\n\n`
            )
          );
        },
        format
      );
      request.signal.addEventListener("abort", () => {
        unsubscribe();
        try {
          controller.close();
        } catch {
          // Already closed by `cancel`.
        }
      });
    },
    cancel() {
      unsubscribe();
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
