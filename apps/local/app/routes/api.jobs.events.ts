import type { Route } from "./+types/api.jobs.events";
import {
  requestSidecar,
  sidecarSocketPath,
} from "@/services/sidecar-socket.server";
import { JOB_STREAM_EVENTS } from "@/features/jobs/job-wire";

/**
 * The browser's one subscription to background **Jobs**: the **Sidecar**'s
 * Job Event stream (`GET /events` on its socket), passed through untouched.
 *
 * READ-ONLY: closing it — a closed tab, a reload — cancels nothing. The Jobs
 * run in the sidecar whether anyone listens or not. `Last-Event-ID` (which
 * the browser's EventSource sends on its own when it reconnects) is passed on,
 * so a tab that drops resumes where it left off.
 *
 * When nothing answers on the socket, it says so as an event and ends; the
 * EventSource tries again after `retry`. The status is always 200 and the
 * type always `text/event-stream`, because an EventSource that gets anything
 * else stops reconnecting for good.
 */
const RETRY_MS = 5_000;

const headers = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
};

export const loader = async ({ request }: Route.LoaderArgs) => {
  const socket = sidecarSocketPath();
  const lastEventId = request.headers.get("last-event-id");
  const upstreamAbort = new AbortController();
  request.signal.addEventListener("abort", () => upstreamAbort.abort());

  let upstream: Awaited<ReturnType<typeof requestSidecar>>;
  try {
    upstream = await requestSidecar({
      socket,
      method: "GET",
      path: "/events",
      headers: lastEventId ? { "last-event-id": lastEventId } : {},
      signal: upstreamAbort.signal,
    });
  } catch (error) {
    const message = `The sidecar is not running (nothing answers on ${socket}): background jobs wait in the queue until it starts. ${String(error)}`;
    return new Response(
      `retry: ${RETRY_MS}\nevent: ${JOB_STREAM_EVENTS.sidecarUnavailable}\ndata: ${JSON.stringify({ message })}\n\n`,
      { headers }
    );
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(`retry: ${RETRY_MS}\n\n`));
      upstream.on("data", (chunk: Buffer) =>
        controller.enqueue(new Uint8Array(chunk))
      );
      // The sidecar went away mid-stream (a restart): end, and let the
      // browser reconnect.
      upstream.on("end", () => controller.close());
      upstream.on("error", () => controller.close());
    },
    cancel() {
      upstreamAbort.abort();
      upstream.destroy();
    },
  });
  return new Response(stream, { headers });
};
