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
    return watchLatestFrame(props.url, (frame) => {
      if (canvas.width !== frame.displayWidth)
        canvas.width = frame.displayWidth;
      if (canvas.height !== frame.displayHeight)
        canvas.height = frame.displayHeight;
      ctx.drawImage(frame, 0, 0);
      frame.close();
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
