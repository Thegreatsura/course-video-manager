import { useEffect, useRef } from "react";
import type { CompositeSourceFrame } from "./draw-composite";
import { watchLatestFrame } from "./latest-frame";

/**
 * A recorder preview feed's newest frame and when it came, in a ref for a
 * canvas to draw (`watchLatestFrame`); undefined until the first comes, and
 * while `url` is undefined. A ref, not state: frames come 30 or 60 times a second and only the
 * canvas reads them. A new `url` or `key` starts again from no frame.
 */
export const useLatestFrame = (url: string | undefined, key?: string) => {
  const frame = useRef<
    { source: CompositeSourceFrame; atMs: number } | undefined
  >(undefined);
  useEffect(() => {
    if (!url) return;
    let current: VideoFrame | undefined;
    const stop = watchLatestFrame(url, (video) => {
      current?.close();
      current = video;
      frame.current = {
        source: {
          image: video,
          size: { width: video.displayWidth, height: video.displayHeight },
        },
        // performance.now(): the clock requestAnimationFrame's timestamps are on.
        atMs: performance.now(),
      };
    });
    return () => {
      stop();
      current?.close();
      frame.current = undefined;
    };
  }, [url, key]);
  return frame;
};
