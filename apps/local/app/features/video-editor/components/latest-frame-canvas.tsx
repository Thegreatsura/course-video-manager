import { useEffect, useRef } from "react";
import { watchLatestFrame } from "../latest-frame";

/**
 * A recorder preview feed on its own (the thumbnail camera's preview): each
 * new frame drawn on a canvas as it comes (`watchLatestFrame`), the canvas
 * sized to the frame and fitted by CSS like an `<img>`.
 */
export const LatestFrameCanvas = (props: {
  url: string;
  className?: string;
  "aria-label"?: string;
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    return watchLatestFrame(props.url, (bitmap) => {
      if (canvas.width !== bitmap.width) canvas.width = bitmap.width;
      if (canvas.height !== bitmap.height) canvas.height = bitmap.height;
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
    });
  }, [props.url]);
  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={props["aria-label"]}
      className={props.className}
    />
  );
};
