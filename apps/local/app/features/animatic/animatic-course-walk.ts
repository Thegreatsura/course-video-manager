import {
  ANIMATIC_FPS,
  segmentIndexAtFrame,
  type AnimaticSegment,
} from "./animatic-timeline";

/**
 * LEFT and RIGHT, and CTRL+LEFT and CTRL+RIGHT, walked off the edge of one
 * Animatic into the Course around it (#2414).
 *
 * Inside a Video's Animatic, LEFT and RIGHT step the playhead a Clip Mockup at
 * a time. Off its last Clip Mockup, RIGHT carries on into the NEXT VIDEO's
 * Animatic, from the top, playing — so a Lesson, a Section, a whole Course can
 * be watched with one key, the way the author walks a Lesson's Videos with
 * NEXT. LEFT mirrors it, with YouTube's grace period: in the first second of
 * the first Clip Mockup it goes back to the previous Video, at that Video's
 * LAST Clip Mockup; past that second it restarts the Clip Mockup.
 *
 * CTRL is the same walk a level up, by Section. CTRL+RIGHT opens the next
 * Section's first Animatic. CTRL+LEFT goes back to the start of THIS Section,
 * and only from its very start (its first Video, first Clip Mockup, first
 * second) does it go back a Section.
 *
 * A Video with no Clip Mockups has no Animatic to watch, so every walk STEPS
 * OVER it, and a Section with none is stepped over the same way. At either end
 * of the Course the key holds. Course order is the order PREVIOUS/NEXT walks:
 * Section, then Lesson, then Video by title.
 */

/** Where an Animatic opens when a walk arrives at it. */
export type AnimaticStart = "first" | "last";

/**
 * The Videos a walk can land on, seen from the current one. Worked out by the
 * loader from the Course's navigation tree, so the keys answer at once. Every
 * id names a Video that has Clip Mockups; `null` is "nowhere to go".
 */
export interface AnimaticNeighbours {
  previousVideoId: string | null;
  nextVideoId: string | null;
  /**
   * The current Section's first Video with Clip Mockups — `null` when that is
   * the current Video itself, or when there is no Section.
   */
  sectionStartVideoId: string | null;
  previousSectionVideoId: string | null;
  nextSectionVideoId: string | null;
}

export const NO_ANIMATIC_NEIGHBOURS: AnimaticNeighbours = {
  previousVideoId: null,
  nextVideoId: null,
  sectionStartVideoId: null,
  previousSectionVideoId: null,
  nextSectionVideoId: null,
};

/**
 * The neighbours of `currentVideoId`, given the Course's Sections with each
 * one's Video ids in Course order, and the set of Videos that have Clip
 * Mockups. A Video not in the Course (a standalone Video) has none.
 */
export function animaticNeighbours(props: {
  sections: ReadonlyArray<{ videoIds: ReadonlyArray<string> }>;
  withClipMockups: ReadonlySet<string>;
  currentVideoId: string;
}): AnimaticNeighbours {
  const { withClipMockups, currentVideoId } = props;
  // Only the Videos a walk can stop on, plus the current one so it can be
  // found even before its first Clip Mockup lands.
  const sections = props.sections.map((section) =>
    section.videoIds.filter(
      (id) => id === currentVideoId || withClipMockups.has(id)
    )
  );
  const sectionIndex = sections.findIndex((ids) =>
    ids.includes(currentVideoId)
  );
  if (sectionIndex < 0) return NO_ANIMATIC_NEIGHBOURS;

  const watchable = sections.map((ids) =>
    ids.filter((id) => withClipMockups.has(id))
  );
  const flat = sections.flat();
  const index = flat.indexOf(currentVideoId);
  const firstOf = (ids: ReadonlyArray<string> | undefined) => ids?.[0] ?? null;
  const sectionStart = firstOf(watchable[sectionIndex]);

  return {
    previousVideoId:
      flat.slice(0, index).findLast((id) => withClipMockups.has(id)) ?? null,
    nextVideoId:
      flat.slice(index + 1).find((id) => withClipMockups.has(id)) ?? null,
    sectionStartVideoId: sectionStart === currentVideoId ? null : sectionStart,
    previousSectionVideoId: firstOf(
      watchable.slice(0, sectionIndex).findLast((ids) => ids.length > 0)
    ),
    nextSectionVideoId: firstOf(
      watchable.slice(sectionIndex + 1).find((ids) => ids.length > 0)
    ),
  };
}

/**
 * What one press does. `seek` stays on this Animatic: `keep` holds whatever
 * the Player was doing (a step), `play` starts it (a jump to a start). `open`
 * is a route change to another Video's Animatic, which opens at `start` and
 * plays.
 */
export type AnimaticStep =
  | { type: "seek"; frame: number; playback: "keep" | "play" }
  | { type: "open"; videoId: string; start: AnimaticStart }
  | null;

/**
 * Resolve a press of LEFT/RIGHT (`level: "clip-mockup"`) or CTRL+LEFT/RIGHT
 * (`level: "section"`) against where the playhead is. `frame` is the Player's
 * own current frame, not the highlighted row, which lags a frame behind.
 */
export function resolveAnimaticStep(props: {
  level: "clip-mockup" | "section";
  delta: -1 | 1;
  segments: ReadonlyArray<AnimaticSegment>;
  frame: number;
  neighbours: AnimaticNeighbours;
}): AnimaticStep {
  const { segments, frame, neighbours } = props;
  const index = segmentIndexAtFrame(segments, frame);
  if (index < 0) return null;
  // The grace period: inside it, "back" means the thing before this one.
  const inFirstSecond = index === 0 && frame < ANIMATIC_FPS;
  const open = (videoId: string | null, start: AnimaticStart): AnimaticStep =>
    videoId === null ? null : { type: "open", videoId, start };

  if (props.level === "section") {
    if (props.delta === 1) return open(neighbours.nextSectionVideoId, "first");
    if (neighbours.sectionStartVideoId !== null) {
      return open(neighbours.sectionStartVideoId, "first");
    }
    if (inFirstSecond) return open(neighbours.previousSectionVideoId, "first");
    return { type: "seek", frame: 0, playback: "play" };
  }

  if (props.delta === 1) {
    const next = segments[index + 1];
    if (next) return { type: "seek", frame: next.startFrame, playback: "keep" };
    return open(neighbours.nextVideoId, "first");
  }
  if (index > 0) {
    return {
      type: "seek",
      frame: segments[index - 1]!.startFrame,
      playback: "keep",
    };
  }
  if (inFirstSecond) return open(neighbours.previousVideoId, "last");
  return { type: "seek", frame: 0, playback: "keep" };
}

/**
 * The router state a walk navigates with: where the arriving Animatic opens.
 * In navigation state rather than the URL, so a reload or a copied link opens
 * the Animatic at the top, paused, as it always has.
 */
export interface AnimaticStartIntent {
  animaticStart: AnimaticStart;
}

export function readAnimaticStartIntent(state: unknown): AnimaticStart | null {
  if (typeof state !== "object" || state === null) return null;
  const start = (state as Partial<AnimaticStartIntent>).animaticStart;
  return start === "first" || start === "last" ? start : null;
}
