import { useEffect, useRef } from "react";
import type { VideoFormat } from "@/features/videos/video-format";
import { CANVASES, type Scene } from "@/packages/scene-layout";
import { drawComposite } from "../draw-composite";
import { useLatestFrame } from "../use-latest-frame";

/**
 * The exact final picture, live: the recorder's camera and screen preview
 * feeds drawn on a canvas by the layout module's draw instructions for the
 * scene the recorder is in. Each feed's newest frame is pulled as it comes
 * (`useLatestFrame`); the canvas redraws them every animation frame. A feed with no frame yet
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
  /** Changes when the camera comes back, so its last frame is dropped. */
  cameraKey: string;
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const camera = useLatestFrame(
    props.cameraShowing ? props.previews.camera : undefined,
    props.cameraKey
  );
  const screen = useLatestFrame(props.previews.screen);
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
        { camera: camera.current, screen: screen.current },
        format
      );
    };
    draw();
    return () => cancelAnimationFrame(frame);
  }, [scene, format, camera, screen]);

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
    </div>
  );
};
