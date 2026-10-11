import type { Route } from "./+types/api.videos.$videoId.recorder.events";
import { recorderClient } from "@/services/recorder-client/live.server";

/**
 * The editor's subscription to a New recorder Video's Recording Sessions
 * (`NewRecorderMessage`, one SSE event each, named by its `type`). It only
 * listens: closing it stops nothing, because the recorder service and the
 * app server's recorder client record and save whether anyone listens.
 */
export const loader = ({ params, request }: Route.LoaderArgs) => {
  const encoder = new TextEncoder();
  let unsubscribe = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      unsubscribe = recorderClient().subscribe(params.videoId, (message) => {
        controller.enqueue(
          encoder.encode(
            `event: ${message.type}\ndata: ${JSON.stringify(message)}\n\n`
          )
        );
      });
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
