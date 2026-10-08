/**
 * I / O nudge a `<ChooseScreenshot>` placeholder's frame back / forward by a
 * step of seconds, inside its clip. At the clip's edge the next press crosses
 * into the neighbouring clip instead:
 *
 * - The first press clamps to the edge, so the clip's first and last frames
 *   are always reachable as screenshot candidates.
 * - A press while already at the edge changes clip. I lands on the previous
 *   clip's END and O on the next clip's START, so the walk reads as one
 *   continuous strip of footage.
 * - At the first / last clip there is nowhere to cross to: nothing happens.
 */

export type FrameStepDirection = 1 | -1;

export type FrameStep =
  | { type: "seek"; time: number }
  | { type: "change-clip"; newIndex: number; landAt: "start" | "end" }
  | null;

/** How close to an edge counts as "at" it; video seeks are not exact. */
const AT_EDGE_EPSILON = 0.05;

export function stepScreenshotFrame({
  time,
  clipStart,
  clipEnd,
  clipIndex,
  clipCount,
  step,
  direction,
}: {
  time: number;
  clipStart: number;
  clipEnd: number;
  /** 1-based, as in `<ChooseScreenshot clipIndex={…}>`. */
  clipIndex: number;
  clipCount: number;
  step: number;
  direction: FrameStepDirection;
}): FrameStep {
  if (direction === -1) {
    if (time - clipStart > AT_EDGE_EPSILON) {
      return { type: "seek", time: Math.max(clipStart, time - step) };
    }
    return clipIndex > 1
      ? { type: "change-clip", newIndex: clipIndex - 1, landAt: "end" }
      : null;
  }
  if (clipEnd - time > AT_EDGE_EPSILON) {
    return { type: "seek", time: Math.min(clipEnd, time + step) };
  }
  return clipIndex < clipCount
    ? { type: "change-clip", newIndex: clipIndex + 1, landAt: "start" }
    : null;
}
