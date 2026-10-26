/**
 * A rectangle of a screen frame, as fractions (0–1) of its width and height,
 * so it holds at any size the frame is recorded or shown at.
 */
export type ScreenCrop = {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
};

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** The crop kept inside the frame. */
export const clampCrop = (crop: ScreenCrop): ScreenCrop => {
  const x = clamp01(crop.x);
  const y = clamp01(crop.y);
  return {
    x,
    y,
    w: clamp01(Math.min(crop.w, 1 - x)),
    h: clamp01(Math.min(crop.h, 1 - y)),
  };
};

/** ffmpeg's crop of a fraction of the frame, at the frame's own size. */
export const cropFilter = (crop: ScreenCrop) =>
  `crop=w=iw*${crop.w}:h=ih*${crop.h}:x=iw*${crop.x}:y=ih*${crop.y}`;
