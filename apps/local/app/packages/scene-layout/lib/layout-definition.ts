// One layout per Video Format, each with the same three scenes.
//
// Landscape: copied from the OBS-free recorder spike's `layouts.json`
// (branch `spike/obs-free-recorder`), which was derived from Matt's OBS scene
// collection (profile Landscape Recording, canvas 1920x1080).
//
// Short: copied from OBS's TikTok Face / TikTok Code / TikTok Code No Face
// (profile TikTok, canvas 1080x1920), as the visible part of each item (PRD
// #2052, "Layout module"). The screen is the Spacedesk display, 1080x1080
// (ADR 0043), drawn whole and 1:1 at the top of the canvas. A 1920x1080
// Spacedesk display is still accepted while Matt switches: OBS drew it 1:1 at
// (0,0), so a Short shows its left 1080x1080 square and the rest falls off
// the canvas. Both are the screen's left square (`"left-square"`).
//
// - `crop` is a fraction of the source frame, so one definition holds for the
//   camera (opened at 4K, recorded at 2560x1440), the screen recording
//   (60 fps at its native size: the DELL's 1920x1080, Spacedesk's 1080x1080)
//   and the low-res previews alike. `"left-square"` is the source's left
//   square, as tall as the source: the whole of a square source, the left
//   1080 of a 1920x1080 one. The Short's screen is one or the other, so its
//   crop cannot be a fixed fraction.
// - `dest` is canvas pixels (OBS pos and cropped size x scale).
// - Items are bottom to top, as in OBS. Items fully off the canvas are kept so
//   the definition stays a faithful copy of OBS; they are never drawn.
// - There is no Empty scene (decision log #1993, Q5).
//
// Bump a layout's `version` whenever anything in it changes what a scene looks
// like: it is part of the Export Hash, so every CVM-recorder export in that
// format goes stale.

import type { VideoFormat } from "@/features/videos/video-format";

export const SCENES = ["Camera", "Code", "No Face"] as const;
export type Scene = (typeof SCENES)[number];

export type LayoutSource = "screen" | "camera";

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * A fraction of the source frame, or its left square: a square source whole,
 * a landscape one's left part as wide as it is tall.
 */
export type Crop = Rect | "left-square";

export interface LayoutItem {
  readonly source: LayoutSource;
  readonly crop: Crop;
  readonly dest: Rect;
}

export interface Layout {
  readonly version: number;
  readonly canvas: { readonly width: number; readonly height: number };
  readonly scenes: Readonly<Record<Scene, readonly LayoutItem[]>>;
}

const LANDSCAPE = {
  // 2: items scaled bilinear, as OBS draws them (was ffmpeg's bicubic).
  version: 2,
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
} as const satisfies Layout;

const SHORT = {
  // 2: the screen is the Spacedesk display's left 1080x1080 square, 1:1, not
  // the whole frame stretched to 1080x1920.
  // 3: items scaled bilinear, as OBS draws them (was ffmpeg's bicubic).
  // (The screen's crop became "left-square" for a 1080x1080 Spacedesk display,
  // ADR 0043, with no bump: a 1920x1080 screen draws exactly as in 3, and no
  // square screen was ever recorded before.)
  version: 3,
  canvas: { width: 1080, height: 1920 },
  scenes: {
    // TikTok Face: the 4K camera at scale 0.891 (3423x1925) at x=-1157, y=0.
    // OBS's display item underneath is fully covered, so it is left out.
    Camera: [
      {
        source: "camera",
        crop: { x: 0.33801, y: 0, w: 0.31551, h: 0.9974 },
        dest: { x: 0, y: 0, w: 1080, h: 1920 },
      },
    ],
    // TikTok Code: the screen's left square at scale 1 at (0,0), filling the
    // top of the canvas (all of a 1080x1080 screen, the left 1080 of a
    // 1920x1080 one); the camera, cropped 92 px off the top and scaled by
    // 0.498 (1913x1030) at x=-393, y=1080, below it.
    Code: [
      {
        source: "screen",
        crop: "left-square",
        dest: { x: 0, y: 0, w: 1080, h: 1080 },
      },
      {
        source: "camera",
        crop: { x: 0.20544, y: 0.04259, w: 0.56456, h: 0.78079 },
        dest: { x: 0, y: 1080, w: 1080, h: 840 },
      },
    ],
    // TikTok Code No Face: the same square; the camera is hidden in OBS, so it
    // is left out and the band below stays black.
    "No Face": [
      {
        source: "screen",
        crop: "left-square",
        dest: { x: 0, y: 0, w: 1080, h: 1080 },
      },
    ],
  },
} as const satisfies Layout;

export const LAYOUTS: Readonly<Record<VideoFormat, Layout>> = {
  landscape: LANDSCAPE,
  short: SHORT,
};

/** Each format's layout version: part of every CVM-recorder Export Hash. */
export const LAYOUT_VERSIONS: Readonly<Record<VideoFormat, number>> = {
  landscape: LANDSCAPE.version,
  short: SHORT.version,
};

/** The Landscape layout's version (kept for today's Landscape callers). */
export const LAYOUT_VERSION = LANDSCAPE.version;

/** The scene a Recording Session is in before its first scene event. */
export const DEFAULT_SCENE: Scene = "Code";
