/**
 * A recorder preview feed in the browser, one frame at a time (#2144): asks
 * the service for the newest frame after the one it has (`GET
 * /preview/<feed>?after=<seq>`, see `preview-feeds.ts`), decodes it off the
 * main thread and hands it on, then asks again. Never more than one frame in
 * flight, and the service only ever sends the newest, so a page that draws
 * slowly skips frames instead of falling behind.
 *
 * No imports: the preview latency script (`scripts/preview-latency.ts`)
 * serves this file to its browser as it is.
 */

/** Waited before asking again after a failed request (service gone, restarting). */
const RETRY_MS = 500;

/**
 * Calls `onFrame` with each new frame of the feed at `url` until the
 * returned stop is called. The frame is the caller's: it should `close()` it
 * once it draws a newer one.
 */
export const watchLatestFrame = (
  url: string,
  onFrame: (frame: ImageBitmap) => void
): (() => void) => {
  const controller = new AbortController();
  const { signal } = controller;
  const pause = () =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, RETRY_MS);
      signal.addEventListener("abort", () => {
        clearTimeout(timer);
        resolve();
      });
    });

  const run = async () => {
    let after = "";
    while (!signal.aborted) {
      try {
        const res = await fetch(`${url}?after=${after}`, {
          signal,
          cache: "no-store",
        });
        // 204: no new frame came in a while; ask again.
        if (res.status === 204) continue;
        if (!res.ok) {
          await pause();
          continue;
        }
        after = res.headers.get("X-Frame-Seq") ?? "";
        const frame = await createImageBitmap(await res.blob());
        if (signal.aborted) {
          frame.close();
          return;
        }
        onFrame(frame);
      } catch {
        if (!signal.aborted) await pause();
      }
    }
  };
  void run();
  return () => controller.abort();
};
