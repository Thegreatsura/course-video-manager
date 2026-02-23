export const CANVAS_WIDTH = 1280;
export const CANVAS_HEIGHT = 720;

export interface ThumbnailLayers {
  capturedPhoto: string;
  diagramImage: string | null;
  diagramPosition: number;
  cutoutImage: string | null;
  cutoutPosition: number;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/**
 * Draws an image onto a canvas context using crop-to-cover
 * (fills entire canvas, cropping excess).
 */
function drawCropToCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  canvasWidth: number,
  canvasHeight: number
) {
  const imgAspect = img.naturalWidth / img.naturalHeight;
  const canvasAspect = canvasWidth / canvasHeight;

  let sx: number, sy: number, sw: number, sh: number;

  if (imgAspect > canvasAspect) {
    // Image is wider — crop sides
    sh = img.naturalHeight;
    sw = sh * canvasAspect;
    sx = (img.naturalWidth - sw) / 2;
    sy = 0;
  } else {
    // Image is taller — crop top/bottom
    sw = img.naturalWidth;
    sh = sw / canvasAspect;
    sx = 0;
    sy = (img.naturalHeight - sh) / 2;
  }

  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvasWidth, canvasHeight);
}

function drawScaledLayer(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  horizontalPosition: number
) {
  const scale = CANVAS_HEIGHT / img.naturalHeight;
  const scaledWidth = img.naturalWidth * scale;
  // Allow moving 80% off-screen in either direction (20% always visible)
  const minX = -0.8 * scaledWidth;
  const maxX = CANVAS_WIDTH - 0.2 * scaledWidth;
  const x = minX + (maxX - minX) * (horizontalPosition / 100);
  ctx.drawImage(img, x, 0, scaledWidth, CANVAS_HEIGHT);
}

/**
 * Composites all thumbnail layers onto the canvas and returns a data URL.
 * Returns null if the canvas context is unavailable.
 */
export async function composeThumbnailLayers(
  canvas: HTMLCanvasElement,
  layers: ThumbnailLayers
): Promise<string | null> {
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  // Layer 1: Background photo (crop-to-cover)
  const bgImg = await loadImage(layers.capturedPhoto);
  drawCropToCover(ctx, bgImg, CANVAS_WIDTH, CANVAS_HEIGHT);

  // Layer 2: Diagram (scaled to full height, positioned horizontally)
  if (layers.diagramImage) {
    const diagImg = await loadImage(layers.diagramImage);
    drawScaledLayer(ctx, diagImg, layers.diagramPosition);
  }

  // Layer 3: Cutout (scaled to full height, positioned horizontally)
  if (layers.cutoutImage) {
    const cutoutImg = await loadImage(layers.cutoutImage);
    drawScaledLayer(ctx, cutoutImg, layers.cutoutPosition);
  }

  return canvas.toDataURL("image/png");
}
