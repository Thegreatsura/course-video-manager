// The scenes, copied from the OBS-free recorder spike's `layouts.json`
// (branch `spike/obs-free-recorder`), which was derived from Matt's OBS scene
// collection (profile Landscape Recording, canvas 1920x1080).
//
// - `crop` is a fraction of the source frame, so one definition holds for the
//   4K camera, the 2560x1440 screen recording and the low-res previews alike.
// - `dest` is canvas pixels (OBS pos and cropped size x scale).
// - Items are bottom to top, as in OBS. Items fully off the canvas are kept so
//   the definition stays a faithful copy of OBS; they are never drawn.
// - There is no Empty scene (decision log #1993, Q5).
//
// Bump `version` whenever anything here changes what a scene looks like: it is
// part of the Export Hash, so every CVM-recorder export goes stale.

export const SCENES = ["Camera", "Code", "No Face"] as const;
export type Scene = (typeof SCENES)[number];

export type LayoutSource = "screen" | "camera";

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface LayoutItem {
  readonly source: LayoutSource;
  readonly crop: Rect;
  readonly dest: Rect;
}

export const LAYOUT = {
  version: 1,
  canvas: { width: 1920, height: 1080 },
  scenes: {
    Camera: [
      {
        source: "screen",
        crop: { x: 0, y: 0, w: 0.5, h: 1 },
        dest: { x: -1024, y: -18, w: 1024, h: 1152 },
      },
      {
        source: "camera",
        crop: { x: 0, y: 0, w: 1, h: 1 },
        dest: { x: 2, y: 2, w: 1920, h: 1080 },
      },
    ],
    Code: [
      {
        source: "screen",
        crop: { x: 0, y: 0, w: 1, h: 1 },
        dest: { x: 0, y: 0, w: 1920, h: 1080 },
      },
      {
        source: "camera",
        crop: { x: 0.31875, y: 0, w: 0.370833, h: 0.961111 },
        dest: { x: 1429, y: 364, w: 490.96, h: 716.03 },
      },
    ],
    "No Face": [
      {
        source: "screen",
        crop: { x: 0, y: 0, w: 1, h: 1 },
        dest: { x: 0, y: 0, w: 1920, h: 1080 },
      },
      {
        source: "camera",
        crop: { x: 0.266667, y: 0.063889, w: 0.371615, h: 0.897222 },
        dest: { x: 1920, y: 521, w: 412, h: 559 },
      },
    ],
  },
} as const satisfies {
  version: number;
  canvas: { width: number; height: number };
  scenes: Record<Scene, readonly LayoutItem[]>;
};

export const LAYOUT_VERSION = LAYOUT.version;

/** The scene a Recording Session is in before its first scene event. */
export const DEFAULT_SCENE: Scene = "Code";
