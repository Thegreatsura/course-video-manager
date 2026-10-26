import { readStored, writeStored } from "@/hooks/use-local-storage";
import type { VideoFormat } from "@/features/videos/video-format";
import { clampCrop, type ScreenCrop } from "@/packages/clip-source";
import {
  getCenteringSettings,
  getReservedRightWidth,
  type CenteringSettings,
} from "./diagram-centering-settings";

/**
 * The Diagram Frame: the recorded screen the Diagram Playground draws every
 * diagram on, less only the full-height strip on the right reserved for the
 * face (`getReservedRightWidth`). It runs to the screen's top, bottom and
 * left edges: the centring padding is not cut away, because that margin is
 * what makes the screenshot sit well on the page (cutting to the padded safe
 * area put the diagram flush against the crop). It is the same for every
 * diagram, so Choose Screenshot's Diagram option cuts a CVM-recorder Clip's
 * screen frame to it.
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
// v2: a v1 frame was the padded safe area, tight to the diagram; bumping the
// key orphans those, so an install falls back to the computed frame until
// the playground next centres full screen.
const storageKey = (format: VideoFormat) => `diagram-frame:${format}:v2`;

/**
 * The Diagram Frame as fractions of a full-screen window `windowWidth` CSS
 * pixels wide: all of it but the strip reserved for the face on the right,
 * full height. Kept inside the window.
 */
export function diagramFrameOf(
  format: VideoFormat,
  windowWidth: number,
  settings: Pick<CenteringSettings, "faceCamWidth"> = getCenteringSettings()
): ScreenCrop {
  const reserved = getReservedRightWidth(settings, format, windowWidth);
  return clampCrop({
    x: 0,
    y: 0,
    w: Math.max(windowWidth - reserved, 1) / windowWidth,
    h: 1,
  });
}

/**
 * Remember the Diagram Frame for `format` when the window is full screen
 * (`fullScreen`); otherwise the window is not the recorded screen, and
 * nothing is remembered.
 */
export function rememberDiagramFrame(
  format: VideoFormat,
  window: { innerWidth: number; fullScreen: boolean }
): void {
  if (!window.fullScreen) return;
  writeStored(
    storageKey(format),
    JSON.stringify(diagramFrameOf(format, window.innerWidth))
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
 * would remember, from the centring settings' face-cam strip.
 */
export function computedDiagramFrame(
  format: VideoFormat,
  settings: Pick<CenteringSettings, "faceCamWidth"> = getCenteringSettings()
): ScreenCrop {
  return diagramFrameOf(format, RECORDED_SCREENS[format].width, settings);
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
