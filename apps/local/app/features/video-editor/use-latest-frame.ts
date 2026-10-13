import { useEffect, useRef } from "react";
import type { CompositeSourceFrame } from "./draw-composite";
import { watchLatestFrame } from "./latest-frame";

/**
 * A recorder preview feed's newest frame, in a ref for a canvas to draw
 * (`watchLatestFrame`); undefined until the first comes, and while `url` is
 * undefined. A ref, not state: frames come 30 times a second and only the
 * canvas reads them. A new `url` or `key` starts again from no frame.
 */
export const useLatestFrame = (url: string | undefined, key?: string) => {
  const frame = useRef<CompositeSourceFrame | undefined>(undefined);
  useEffect(() => {
    if (!url) return;
    let current: ImageBitmap | undefined;
    const stop = watchLatestFrame(url, (bitmap) => {
      current?.close();
      current = bitmap;
      frame.current = {
        image: bitmap,
        size: { width: bitmap.width, height: bitmap.height },
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
