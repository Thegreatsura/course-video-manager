import type { VideoFormat } from "@/features/videos/video-format";
import {
  CANVASES,
  drawInstructions,
  type Scene,
  type SourceSize,
} from "@/packages/scene-layout";

/** A picture source with a frame to draw, and its size in its own pixels. */
export type CompositeSourceFrame = {
  readonly image: CanvasImageSource;
  readonly size: SourceSize;
};

/**
 * Draws one frame of the composite: black, then the scene's items from the
 * layout module's draw instructions, bottom to top. A source with no frame
 * yet is left out (black), and so is one the scene does not draw. Drawn in
 * `format`'s layout, on its canvas (a Short's is 1080x1920). Shared by the
 * live preview and editor playback.
 */
export const drawComposite = (
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  sources: {
    readonly camera: CompositeSourceFrame | undefined;
    readonly screen: CompositeSourceFrame | undefined;
  },
  format: VideoFormat = "landscape"
) => {
  const canvas = CANVASES[format];
  ctx.fillStyle = "black";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const fallback = { width: 1, height: 1 };
  for (const d of drawInstructions(
    scene,
    {
      camera: sources.camera?.size ?? fallback,
      screen: sources.screen?.size ?? fallback,
    },
    format
  )) {
    const source = sources[d.source];
    if (!source) continue;
    ctx.drawImage(source.image, d.sx, d.sy, d.sw, d.sh, d.dx, d.dy, d.dw, d.dh);
  }
};
