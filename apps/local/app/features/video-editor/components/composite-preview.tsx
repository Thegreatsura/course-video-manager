import { useEffect, useRef } from "react";
import type { VideoFormat } from "@/features/videos/video-format";
import { CANVASES, type Scene } from "@/packages/scene-layout";
import { drawComposite, type CompositeSourceFrame } from "../draw-composite";

/** A feed's frame once it has shown one, else undefined. */
const frameOf = (
  img: HTMLImageElement | null
): CompositeSourceFrame | undefined =>
  img && img.naturalWidth > 0
    ? {
        image: img,
        size: { width: img.naturalWidth, height: img.naturalHeight },
      }
    : undefined;

/**
 * The exact final picture, live: the recorder's camera and screen MJPEG
 * feeds drawn on a canvas by the layout module's draw instructions for the
 * scene the recorder is in. The feeds load in `<img>`s kept out of sight;
 * the canvas redraws them every animation frame. A feed with no frame yet
 * is left out (black). It fills the editor's live frame, where OBS's
 * Virtual Camera would be (`LivePreviewFrame`). A Short is drawn in its own
 * 9:16 layout.
 */
export const CompositePreview = (props: {
  previews: { camera: string; screen: string };
  scene: Scene;
  format: VideoFormat;
  /** Whether the camera feed has anything to show (the Cam Link is live or recording). */
  cameraShowing: boolean;
  /** Changes when the camera comes back, so its stream reconnects. */
  cameraKey: string;
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cameraRef = useRef<HTMLImageElement>(null);
  const screenRef = useRef<HTMLImageElement>(null);
  const { scene, format } = props;
  const canvas = CANVASES[format];

  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    let frame = 0;
    const draw = () => {
      frame = requestAnimationFrame(draw);
      drawComposite(
        ctx,
        scene,
        {
          camera: frameOf(cameraRef.current),
          screen: frameOf(screenRef.current),
        },
        format
      );
    };
    draw();
    return () => cancelAnimationFrame(frame);
  }, [scene, format]);

  const hidden = "pointer-events-none absolute size-px opacity-0";
  return (
    <div
      className="relative w-full h-full overflow-hidden rounded-lg bg-black"
      data-testid="cvm-recorder-composite"
      data-scene={scene}
      data-format={format}
    >
      <canvas
        ref={canvasRef}
        width={canvas.width}
        height={canvas.height}
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
    </div>
  );
};
