import { useEffect, useRef } from "react";
import {
  CANVAS,
  drawInstructions,
  type Scene,
  type SourceSize,
} from "@/packages/scene-layout";

/** A feed's picture size once it has shown a frame, else undefined. */
const sizeOf = (img: HTMLImageElement | null): SourceSize | undefined =>
  img && img.naturalWidth > 0
    ? { width: img.naturalWidth, height: img.naturalHeight }
    : undefined;

/**
 * The exact final picture, live: the recorder's camera and screen MJPEG
 * feeds drawn on a canvas by the layout module's draw instructions for the
 * scene the recorder is in. The feeds load in `<img>`s kept out of sight;
 * the canvas redraws them every animation frame. A feed with no frame yet
 * is left out (black).
 *
 * `overlay` is drawn over it at half opacity: the previous Clip's last
 * frame, to match position between takes.
 */
export const CompositePreview = (props: {
  previews: { camera: string; screen: string };
  scene: Scene;
  /** Whether the camera feed has anything to show (the Cam Link is live or recording). */
  cameraShowing: boolean;
  /** Changes when the camera comes back, so its stream reconnects. */
  cameraKey: string;
  overlay: string | null;
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cameraRef = useRef<HTMLImageElement>(null);
  const screenRef = useRef<HTMLImageElement>(null);
  const { scene } = props;

  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    let frame = 0;
    const draw = () => {
      frame = requestAnimationFrame(draw);
      const images = { camera: cameraRef.current, screen: screenRef.current };
      const camera = sizeOf(images.camera);
      const screen = sizeOf(images.screen);
      ctx.fillStyle = "black";
      ctx.fillRect(0, 0, CANVAS.width, CANVAS.height);
      const fallback = { width: 1, height: 1 };
      for (const d of drawInstructions(scene, {
        camera: camera ?? fallback,
        screen: screen ?? fallback,
      })) {
        const img = images[d.source];
        if (!img || !sizeOf(img)) continue;
        ctx.drawImage(img, d.sx, d.sy, d.sw, d.sh, d.dx, d.dy, d.dw, d.dh);
      }
    };
    draw();
    return () => cancelAnimationFrame(frame);
  }, [scene]);

  const hidden = "pointer-events-none absolute size-px opacity-0";
  return (
    <div
      className="relative w-full aspect-[16/9] overflow-hidden rounded bg-black"
      data-testid="new-recorder-composite"
      data-scene={scene}
    >
      <canvas
        ref={canvasRef}
        width={CANVAS.width}
        height={CANVAS.height}
        className="h-full w-full"
      />
      {props.cameraShowing && (
        <img
          key={props.cameraKey}
          ref={cameraRef}
          src={props.previews.camera}
          crossOrigin="anonymous"
          alt=""
          className={hidden}
        />
      )}
      <img
        ref={screenRef}
        src={props.previews.screen}
        crossOrigin="anonymous"
        alt=""
        className={hidden}
      />
      {props.overlay && (
        <img
          src={props.overlay}
          alt=""
          className="absolute inset-0 h-full w-full object-contain opacity-50"
        />
      )}
    </div>
  );
};
