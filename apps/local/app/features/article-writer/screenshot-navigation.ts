/**
 * L / K walk the Article Writer preview's `<ChooseScreenshot>` placeholders in
 * document order: L to the next one below, K to the previous one above. It
 * STOPS at the ends rather than wrapping — on a first pass top to bottom, a
 * press past the last placeholder doing nothing tells the author he is done,
 * where a jump back to the top would lose his place.
 *
 * I / O nudge the frame of the current placeholder by the large step, and
 * Left / Right by the small one (see `screenshot-frame-step.ts`). Return
 * captures it, then walks on as L would.
 *
 * The decisions live here as pure functions; `useScreenshotNavigation` is the
 * DOM wiring around them.
 */
import { isTypingTarget } from "@/hooks/should-ignore-keyboard-shortcut";

export type ScreenshotNavDirection = 1 | -1;

/** Marks a rendered placeholder's root so the preview can find it. */
export const CHOOSE_SCREENSHOT_ATTR = "data-choose-screenshot";

type NavKeyEvent = Pick<
  KeyboardEvent,
  "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey" | "target"
> &
  Partial<Pick<KeyboardEvent, "repeat">>;

/**
 * Which way a keypress walks, or `null` when it is not ours to take: any
 * modifier held, or focus in something that types (the key must reach it
 * untouched).
 *
 * Deliberately not `shouldIgnoreKeyboardShortcut`: the writer lives inside a
 * dialog, and after clicking a placeholder's Capture or Next button focus sits
 * on a button — that guard would refuse both, and neither is typing.
 */
export function screenshotNavDirection(
  e: NavKeyEvent
): ScreenshotNavDirection | null {
  return keyDirection(e, "l", "k");
}

export type ScreenshotStepSize = "large" | "small";

export interface ScreenshotStep {
  direction: ScreenshotNavDirection;
  size: ScreenshotStepSize;
}

/**
 * I / O nudge the current placeholder's frame by the large step, Left / Right
 * by the small one. Same guard as {@link screenshotNavDirection}. The
 * placeholder hears it as {@link SCREENSHOT_STEP_EVENT}.
 */
export function screenshotStep(e: NavKeyEvent): ScreenshotStep | null {
  const large = keyDirection(e, "o", "i");
  if (large !== null) return { direction: large, size: "large" };
  const small = keyDirection(e, "ArrowRight", "ArrowLeft");
  if (small !== null) return { direction: small, size: "small" };
  return null;
}

/**
 * Whether Return captures the current placeholder. Same guard as the other
 * keys, plus: not a held-down repeat (one press, one capture), and not a
 * control outside the preview — Return must still press the writer's own
 * Apply, Cancel or model picker when focus is on one.
 */
export function isScreenshotCapturePress(
  e: NavKeyEvent,
  preview: Pick<Node, "contains">
): boolean {
  if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return false;
  if (e.key !== "Enter" || e.repeat) return false;
  if (isTypingTarget(e.target)) return false;
  const target = e.target as Element | null;
  if (preview.contains(target as Node | null)) return true;
  return !target?.closest?.(OTHER_CONTROLS);
}

const OTHER_CONTROLS =
  'button, a[href], select, [role="button"], [role="combobox"], [role="menuitem"], [role="option"], [role="tab"]';

function keyDirection(
  e: NavKeyEvent,
  forward: string,
  back: string
): ScreenshotNavDirection | null {
  if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return null;
  if (e.key !== forward && e.key !== back) return null;
  if (isTypingTarget(e.target)) return null;
  return e.key === forward ? 1 : -1;
}

/** Dispatched on a placeholder's root; `detail` is a {@link ScreenshotStep}. */
export const SCREENSHOT_STEP_EVENT = "choose-screenshot-step";

/**
 * Dispatched on a placeholder's root to capture its frame; `detail` is a
 * {@link ScreenshotCaptureRequest}.
 */
export const SCREENSHOT_CAPTURE_EVENT = "choose-screenshot-capture";

export interface ScreenshotCaptureRequest {
  /** Called only once the capture has succeeded. */
  onCaptured: () => void;
}

/** A placeholder's vertical extent, in px relative to the scroll box's top. */
export interface PlaceholderSpan {
  top: number;
  bottom: number;
}

/**
 * The index of the placeholder to scroll to, or `null` at the end of the walk.
 *
 * "The current one" is the placeholder last navigated to, while it is still on
 * screen — so a placeholder that cannot be centred (the last one, near the
 * bottom of the document) does not trap the walk. Once the author has scrolled
 * it away, the walk restarts from wherever the viewport's centre now is.
 */
export function pickScreenshotTarget({
  spans,
  viewportHeight,
  lastVisited,
  direction,
}: {
  spans: PlaceholderSpan[];
  viewportHeight: number;
  lastVisited: number | null;
  direction: ScreenshotNavDirection;
}): number | null {
  const last = lastVisited === null ? undefined : spans[lastVisited];
  if (
    lastVisited !== null &&
    last &&
    last.bottom > 0 &&
    last.top < viewportHeight
  ) {
    const next = lastVisited + direction;
    return next >= 0 && next < spans.length ? next : null;
  }

  const centre = viewportHeight / 2;
  const centres = spans.map((s) => (s.top + s.bottom) / 2);
  // A placeholder already centred is the current one, not the next.
  const EPSILON = 2;
  if (direction === 1) {
    const i = centres.findIndex((c) => c > centre + EPSILON);
    return i === -1 ? null : i;
  }
  for (let i = centres.length - 1; i >= 0; i--) {
    if (centres[i]! < centre - EPSILON) return i;
  }
  return null;
}

/**
 * The placeholder I / O act on: the one L / K last went to while it is still on
 * screen, otherwise the on-screen one nearest the viewport's centre, otherwise
 * none.
 */
export function pickCurrentScreenshot({
  spans,
  viewportHeight,
  lastVisited,
}: {
  spans: PlaceholderSpan[];
  viewportHeight: number;
  lastVisited: number | null;
}): number | null {
  const onScreen = (s: PlaceholderSpan) =>
    s.bottom > 0 && s.top < viewportHeight;
  const last = lastVisited === null ? undefined : spans[lastVisited];
  if (lastVisited !== null && last && onScreen(last)) return lastVisited;

  const centre = viewportHeight / 2;
  let best: number | null = null;
  let bestDistance = Infinity;
  spans.forEach((s, i) => {
    if (!onScreen(s)) return;
    const distance = Math.abs((s.top + s.bottom) / 2 - centre);
    if (distance < bestDistance) {
      best = i;
      bestDistance = distance;
    }
  });
  return best;
}
