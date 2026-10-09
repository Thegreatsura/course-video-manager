/**
 * One dot per clip in the current recording session, oldest first, under the
 * capture indicator on the glass.
 *
 * Two axes, read independently:
 *
 *   fill   — hollow while the frontend is the only one that has heard the clip,
 *            solid once a database clip has paired with it.
 *   colour — white for healthy, amber for orphaned, red for deleted.
 *
 * The point is the *filling in*. A take in good health is a column of dots
 * going solid a beat behind your voice, so a dot that stays hollow after the
 * ones around it have filled is the frontend speech detector having heard
 * something the backend's silence detection didn't agree with. Watching for a
 * gap in a rhythm is easier, on camera, than counting anything — which is why
 * this shows marks rather than the numbers originally asked for.
 *
 * Three wide, growing downward, so a long take reads as a column getting longer
 * rather than a row getting denser — and exactly as wide as the capture
 * indicator above it, so the two read as one instrument rather than two things
 * that happen to be near each other.
 *
 * One more colour, over both axes: light blue for the Clip the Video Editor is
 * playing right now. Clicking a landed dot plays its Clip in the editor, or
 * pauses it if it is the one playing, so a take can be checked from the glass.
 * Every other dot has no Clip on the timeline to play, so it is not clickable.
 *
 * Colours are the editor's own vocabulary from `recording-session-panel.tsx`
 * (amber = orphaned, red = archived): you should not have to learn a second
 * vocabulary while filming.
 *
 * Updates live, deliberately. #1435 says motion in the filming field of view is
 * the thing to avoid, and that still holds for anything decorative — but a dot
 * appearing the instant the capture indicator turns green *is* the signal here,
 * so holding it back until silence would remove the only thing this display is
 * for. Nothing animates; marks appear, fill, and change colour in place.
 */
import type { ClipMarks, ClipMarkState } from "@/lib/teleprompter-protocol";
import { TYPE } from "./teleprompter-settings";

/** Under the capture dot: top-4 (1rem) + size-14 (3.5rem) + a gap. */
const ANCHOR = "absolute left-4 top-20 z-40 select-none";

const PER_ROW = 3;
/**
 * A cap only so a long take can't march off the bottom of the panel. Twelve
 * rows sits inside the Elgato Prompter's 600px height with the controls still
 * clear.
 */
export const MAX_MARKS = PER_ROW * 12;

const OK = "#fff";
const ORPHANED = "var(--color-amber-400)";
const DELETED = "var(--color-red-500)";
/** Being played in the Video Editor right now. */
const PLAYING = "var(--color-sky-300)";

const MARK: Record<ClipMarkState, { colour: string; filled: boolean }> = {
  // Heard, not yet confirmed. Appears the moment the capture indicator turns
  // green, so the glass and the editor never disagree about what's been heard.
  pending: { colour: OK, filled: false },
  // Paired with a database clip. This is what every dot should become.
  landed: { colour: OK, filled: true },
  // No database clip is coming. The one worth stopping for.
  orphaned: { colour: ORPHANED, filled: false },
  // Deleted by hand. Still shown, because a dot vanishing mid-take would read
  // as a clip lost rather than a clip discarded.
  "deleted-pending": { colour: DELETED, filled: false },
  "deleted-landed": { colour: DELETED, filled: true },
};

/**
 * Trims a long take down to what fits, dropping the oldest *landed* marks
 * first.
 *
 * A landed mark has already told you everything it is going to tell you, so
 * folding it into the "+N" costs nothing. A mark that hasn't landed is the
 * whole reason this display exists, so it stays visible however old it gets —
 * a leak scrolling silently off the top would be the one failure this must not
 * have. Order is otherwise preserved, and the tail of the take is intact, so
 * the rhythm you're actually watching still reads.
 *
 * If even the unlanded marks overflow, something has gone badly wrong and the
 * newest win; the count carries the rest.
 */
export function fitMarks<T extends ClipMarkState | { state: ClipMarkState }>(
  marks: T[]
): {
  shown: T[];
  folded: number;
} {
  if (marks.length <= MAX_MARKS) return { shown: marks, folded: 0 };

  const isLanded = (mark: T) => {
    const state = typeof mark === "string" ? mark : mark.state;
    return state === "landed" || state === "deleted-landed";
  };

  const kept: T[] = [];
  let budget = MAX_MARKS;

  // Newest first, so the oldest landed marks are the ones that fall off.
  for (let i = marks.length - 1; i >= 0; i--) {
    const state = marks[i]!;
    if (budget > 0) {
      kept.push(state);
      budget--;
    } else if (!isLanded(state)) {
      // Over budget, but this one can't be dropped. `kept` runs newest-first,
      // so the last landed entry in it is the oldest one we're holding — give
      // that back to make room.
      const surrendered = kept.findLastIndex(isLanded);
      if (surrendered === -1) break;
      kept.splice(surrendered, 1);
      kept.push(state);
    }
  }

  kept.reverse();
  return { shown: kept, folded: marks.length - kept.length };
}

export function SessionMarks(props: {
  marks: ClipMarks;
  /** The Clip each mark stands for, same order as `marks`. */
  clipIds?: string[];
  /** The Clip the editor is playing, drawn light blue. */
  playingClipId?: string | null;
  onMarkClicked?: (clipId: string) => void;
}) {
  // No session, nothing on the glass. The empty state is the point, so it isn't
  // drawn as an empty container.
  if (props.marks.length === 0) return null;

  const { shown, folded } = fitMarks(
    props.marks.map((state, i) => ({
      state,
      clipId: props.clipIds?.[i] ?? null,
    }))
  );

  return (
    <div className={ANCHOR} data-testid="session-marks">
      {/*
        `w-14` is the capture indicator's `size-14`, and the dots divide that
        width rather than being sized independently — so the column lines up
        with the circle above it whatever the gap is set to. Wrapping is the
        grid's job, which is why there is no row chunking here.
      */}
      <div
        className="grid w-14 gap-1.5"
        style={{ gridTemplateColumns: `repeat(${PER_ROW}, 1fr)` }}
      >
        {shown.map(({ state, clipId }, i) => {
          const playing = clipId !== null && clipId === props.playingClipId;
          const mark = playing
            ? { colour: PLAYING, filled: true }
            : MARK[state];
          // Only a landed Clip is on the timeline to play: a pending one has
          // no database Clip yet, an orphaned one never will, and a deleted
          // one is archived. Those dots are not offered as buttons at all.
          const onClick =
            clipId !== null && state === "landed" && props.onMarkClicked
              ? () => props.onMarkClicked!(clipId)
              : undefined;
          return (
            <div
              key={i}
              data-mark={state}
              data-playing={playing || undefined}
              role={onClick ? "button" : undefined}
              aria-label={
                onClick ? (playing ? "Pause clip" : "Play clip") : undefined
              }
              onClick={onClick}
              className={`aspect-square w-full rounded-full ${
                onClick ? "cursor-pointer" : ""
              }`}
              style={{
                // A hollow dot is a ring rather than a dimmed circle: through
                // beam-splitter glass "dim" and "solid" are hard to tell apart
                // at a glance, but "hole" and "no hole" aren't.
                background: mark.filled ? mark.colour : "transparent",
                boxShadow: mark.filled
                  ? undefined
                  : `inset 0 0 0 2px ${mark.colour}`,
              }}
            />
          );
        })}
      </div>

      {folded > 0 && (
        <div
          className="mt-2.5"
          style={{
            fontFamily: TYPE.fontFamily,
            fontVariantNumeric: "tabular-nums",
            fontWeight: 300,
            fontSize: 13,
            color: TYPE.cueColor,
          }}
        >
          +{folded}
        </div>
      )}
    </div>
  );
}
