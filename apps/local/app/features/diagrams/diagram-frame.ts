import { readStored, writeStored } from "@/hooks/use-local-storage";
import type { VideoFormat } from "@/features/videos/video-format";
import { clampCrop, type ScreenCrop } from "@/packages/clip-source";

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
 * has remembered none, and the Diagram option is not offered.
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
