import { Cause, Effect, type ManagedRuntime } from "effect";
import { failureHeadline } from "@/services/format-failure-cause";

export type SendEvent = (event: string, data: unknown) => void;

interface SSEErrorHandler {
  tag: string;
  handler: (error: any, sendEvent: SendEvent) => void;
}

interface SSEResponseConfig<R, RE> {
  runtime: ManagedRuntime.ManagedRuntime<R, RE>;
  program: (sendEvent: SendEvent) => Effect.Effect<void, any, R>;
  errorHandlers?: SSEErrorHandler[];
  fallbackMessage?: string;
}

export function createSSEResponse<R, RE>(
  config: SSEResponseConfig<R, RE>
): Response {
  const encoder = new TextEncoder();
  // Aborts the running program when the client disconnects, so we stop
  // doing work (and enqueueing events) for a stream nobody is reading.
  const abortController = new AbortController();

  const stream = new ReadableStream({
    start(controller) {
      // Once the stream is closed — either because the program finished or
      // because the client disconnected (`cancel`) — any further enqueue or
      // close would throw "Invalid state: Controller is already closed".
      let closed = false;

      const sendEvent: SendEvent = (event, data) => {
        if (closed) return;
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        );
      };

      abortController.signal.addEventListener("abort", () => {
        closed = true;
      });

      const fallbackMessage =
        config.fallbackMessage ?? "An unexpected error occurred";

      let effect: Effect.Effect<void, any, any> = config
        .program(sendEvent)
        .pipe(
          // Every failure and every defect is logged here, with its full cause,
          // before anything turns it into a one-line event for the browser.
          // Without this, a failed job's only trace was a toast.
          Effect.tapErrorCause((cause) =>
            // A client that disconnects interrupts the program; that is not a
            // failure worth a log line.
            Cause.isInterruptedOnly(cause)
              ? Effect.void
              : Effect.logError("SSE stream failed", cause)
          )
        );

      if (config.errorHandlers) {
        for (const { tag, handler } of config.errorHandlers) {
          effect = effect.pipe(
            Effect.catchTag(tag, (e) =>
              Effect.sync(() => handler(e, sendEvent))
            )
          );
        }
      }

      effect
        .pipe(
          // The client shows the first line of the real cause; the rest is in
          // the log line above.
          Effect.catchAll((e) =>
            Effect.sync(() => {
              sendEvent("error", {
                message: failureHeadline(e) ?? fallbackMessage,
              });
            })
          ),
          // A defect (a throw, an `Effect.die`) used to reject the run and
          // close the stream with no event, so the browser saw a dropped
          // connection and no reason. It gets an error event like a failure.
          Effect.catchAllDefect((defect) =>
            Effect.sync(() => {
              sendEvent("error", {
                message: failureHeadline(defect) ?? fallbackMessage,
              });
            })
          ),
          (self) =>
            config.runtime.runPromise(self, {
              signal: abortController.signal,
            })
        )
        // The program rejects only when interrupted by the abort signal (every
        // failure and defect is caught above); that is expected on client
        // disconnect and must not go unhandled.
        .catch(() => {})
        .finally(() => {
          if (closed) return;
          closed = true;
          controller.close();
        });
    },
    cancel() {
      // Client disconnected: the controller is already closed by the stream
      // machinery, so interrupt the program and let `start`'s `finally` skip
      // its own `controller.close()`.
      abortController.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
