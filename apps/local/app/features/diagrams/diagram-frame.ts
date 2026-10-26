import { readStored, writeStored } from "@/hooks/use-local-storage";
import type { VideoFormat } from "@/features/videos/video-format";
import { clampCrop, type ScreenCrop } from "@/packages/clip-source";
import {
  getCenteringSettings,
  getCentringInsets,
  type CenteringSettings,
} from "./diagram-centering-settings";

/**
 * The Diagram Frame: the rectangle of the recorded screen the Diagram
 * Playground centres every diagram in (its safe area: inside the padding,
 * left of the face-cam strip; see `getCentringInsets`). It is the same for
 * every diagram, so Choose Screenshot's Diagram option cuts a CVM-recorder
 * Clip's screen frame to it.
 *
 * The playground remembers it, per Video Format, each time it centres while
 * full screen. Full screen is what makes it a rectangle of the recorded
 * screen: the window then covers exactly its monitor, with no browser chrome
 * and no offset from other monitors, so a fraction of the window is the same
 * fraction of the screen the recorder captures at its native size, whatever
 * the device pixel ratio. A playground that has never centred full screen
 * has remembered none: `diagramFrameFor` then computes it the same way, for
 * the screen the recorder captures for that format (`RECORDED_SCREENS`), so
 * the Diagram option is always offered.
 *
 * It assumes the playground is full screen on the monitor the recorder
 * captures (the DELL for a Landscape Video, Spacedesk for a Short): nothing
 * stored says which monitor it was on.
 */
const storageKey = (format: VideoFormat) => `diagram-frame:${format}:v1`;

/** A rectangle in the window's CSS pixels. */
export interface WindowRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The Diagram Frame as fractions of a full-screen window (`windowWidth` x
 * `windowHeight` CSS pixels), from the safe area in the window's pixels.
 * Kept inside the window.
 */
export function diagramFrameOf(
  safeArea: WindowRect,
  windowWidth: number,
  windowHeight: number
): ScreenCrop {
  return clampCrop({
    x: safeArea.x / windowWidth,
    y: safeArea.y / windowHeight,
    w: safeArea.w / windowWidth,
    h: safeArea.h / windowHeight,
  });
}

/**
 * Remember the Diagram Frame for `format`, from a centring's safe area, when
 * the window is full screen (`fullScreen`); otherwise the window is not the
 * recorded screen, and nothing is remembered.
 */
export function rememberDiagramFrame(
  format: VideoFormat,
  safeArea: WindowRect,
  window: { innerWidth: number; innerHeight: number; fullScreen: boolean }
): void {
  if (!window.fullScreen) return;
  writeStored(
    storageKey(format),
    JSON.stringify(
      diagramFrameOf(safeArea, window.innerWidth, window.innerHeight)
    )
  );
}

const isFraction = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1;

/**
 * The screen the recorder captures for each Video Format, in the CSS pixels
 * of a full-screen playground on it: the DELL for a Landscape Video, the
 * 1080x1080 Spacedesk display for a Short (ADR 0043).
 */
export const RECORDED_SCREENS: Record<
  VideoFormat,
  { readonly width: number; readonly height: number }
> = {
  landscape: { width: 1920, height: 1080 },
  short: { width: 1080, height: 1080 },
};

/**
 * The Diagram Frame a full-screen playground on `format`'s recorded screen
 * would remember, from the centring settings: the same safe area
 * `centreCameraOnContent` centres in, with the canvas filling the window.
 */
export function computedDiagramFrame(
  format: VideoFormat,
  settings: CenteringSettings = getCenteringSettings()
): ScreenCrop {
  const { width, height } = RECORDED_SCREENS[format];
  const insets = getCentringInsets(settings, format, { x: 0, w: width }, width);
  return diagramFrameOf(
    {
      x: insets.left,
      y: insets.top,
      w: Math.max(width - insets.left - insets.right, 1),
      h: Math.max(height - insets.top - insets.bottom, 1),
    },
    width,
    height
  );
}

/**
 * The Diagram Frame for `format`: the one the playground remembered, else
 * the one it would remember on the recorded screen (`computedDiagramFrame`).
 */
export function diagramFrameFor(format: VideoFormat): ScreenCrop {
  return readDiagramFrame(format) ?? computedDiagramFrame(format);
}

/** The remembered Diagram Frame for `format`, or null when there is none. */
export function readDiagramFrame(format: VideoFormat): ScreenCrop | null {
  try {
    const parsed: unknown = JSON.parse(
      readStored(storageKey(format)) ?? "null"
    );
    if (typeof parsed !== "object" || parsed === null) return null;
    const { x, y, w, h } = parsed as Record<string, unknown>;
    return isFraction(x) &&
      isFraction(y) &&
      isFraction(w) &&
      isFraction(h) &&
      w > 0 &&
      h > 0
      ? { x, y, w, h }
      : null;
  } catch {
    return null;
  }
}
