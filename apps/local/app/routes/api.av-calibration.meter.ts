import { Effect } from "effect";
import { recorderClient } from "@/services/recorder-client/live.server";
import { makeLoader } from "@/services/route-action.server";

/**
 * The AV Calibration page's level meter (`LevelMeterMessage`, one SSE
 * event each, named by its `type`). Listening runs the meter on the recorder
 * service; the last listener closing stops it, and lets the mic go.
 */
export const loader = makeLoader({
  effect: ({ request }) => Effect.sync(() => meterStream(request)),
});

const meterStream = (request: Request) => {
  const encoder = new TextEncoder();
  let unsubscribe = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      unsubscribe = recorderClient().subscribeMeter((message) => {
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
