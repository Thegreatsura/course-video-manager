/**
 * The Animatic on the glass, read as lines: every Clip Mockup's spoken line,
 * one clip at a time, under its Clip Mockup Chapter. The author often films
 * from these instead of the Script, and each line is one Clip — so each sits
 * apart from the next, with its number in the gutter, and the boundary between
 * two takes is never in doubt.
 *
 * THREE COLUMNS. The lines run down the middle, exactly over the camera, and
 * nothing a still does ever moves them. Clicking a clip shows its still in the
 * left column, level with its line, and clicking it again hides it. A still is
 * faint until it is clicked, so it never shows on the camera as a shadow;
 * clicking the still itself toggles it between faint and full. The right
 * column stays empty. Which stills are shown is a passing choice, never
 * stored, and stills that are shown at once may overlap.
 *
 * Laid out like the Beats view, and for the same reasons: the whole list is on
 * the glass at once, nothing dims, nothing rolls, and position is carried by
 * scroll alone. The lines keep the script's body size, because they are read
 * aloud.
 *
 * Clip Mockup Comments sit under the line or Chapter they hang off, small and
 * white behind a comment icon, marked off by a rule on the left like a note in
 * a margin: the author's notes for this take, never said aloud.
 *
 * Stream Deck: advance/back scroll to the next/previous clip (Chapters are
 * skipped — they are not something you say), reset returns to the top.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MessageSquare } from "lucide-react";
import type { AnimaticLine } from "@/features/animatic/animatic-lines";
import { clipMockupFrameUrl } from "@/features/clip-mockups/clip-mockup-frame-url";
import { useTeleprompterActions } from "./use-teleprompter-actions";
import { TYPE, cueStyle, textStyle } from "./teleprompter-settings";

type ClipMockupLine = Extract<AnimaticLine, { type: "clip-mockup" }>;

/** The comments under one line or Chapter; nothing at all when there are none. */
function Comments(props: { comments: readonly string[] }) {
  if (props.comments.length === 0) return null;
  return (
    <div
      className="mt-2 flex flex-col gap-1 border-l-2 pl-3"
      style={{
        ...textStyle(),
        fontSize: `${TYPE.fontSize * TYPE.animaticCommentScale}px`,
        lineHeight: 1.3,
        color: TYPE.commentColor,
        borderColor: TYPE.commentColor,
        textTransform: "none",
        letterSpacing: "normal",
      }}
    >
      {props.comments.map((body, i) => (
        <p key={i} className="flex items-start gap-[0.4em] whitespace-pre-wrap">
          <MessageSquare
            aria-hidden
            className="mt-[0.2em] size-[0.9em] shrink-0"
          />
          <span className="min-w-0">{body}</span>
        </p>
      ))}
    </div>
  );
}

/** How a shown still looks: faint until the author clicks it. */
type StillState = "dim" | "full";

/**
 * One Clip Mockup's still in the left column. Placed against its row, so it
 * sits level with the line; the row's own width is the middle column, so the
 * left column is half of what is left of the viewport.
 */
function Still(props: {
  clipMockupId: string;
  position: number;
  state: StillState;
  onToggle: () => void;
}) {
  return (
    <img
      src={clipMockupFrameUrl(props.clipMockupId)}
      alt={`Clip ${props.position}`}
      draggable={false}
      onClick={(e) => {
        // The still is not the line: clicking it must not hide it.
        e.stopPropagation();
        props.onToggle();
      }}
      className="absolute top-0 h-auto cursor-pointer rounded-md transition-opacity"
      style={{
        right: "calc(100% + 2rem)",
        width: "calc((100vw - 100%) / 2 - 4rem)",
        opacity: props.state === "full" ? 1 : TYPE.animaticStillDimOpacity,
      }}
    />
  );
}

/** Same guard as the Beats view: a drag to copy words must not move the list. */
function hasSelectedText(): boolean {
  const selection = window.getSelection();
  return (
    !!selection && !selection.isCollapsed && selection.toString().trim() !== ""
  );
}

export function AnimaticView(props: { lines: AnimaticLine[] }) {
  const { lines } = props;
  const clips = useMemo(
    () => lines.filter((l): l is ClipMockupLine => l.type === "clip-mockup"),
    [lines]
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const [activeIndex, setActiveIndex] = useState(0);
  const [stills, setStills] = useState<ReadonlyMap<string, StillState>>(
    new Map()
  );

  const toggleStill = (id: string) =>
    setStills((prev) => {
      const next = new Map(prev);
      if (next.has(id)) next.delete(id);
      else next.set(id, "dim");
      return next;
    });

  const toggleStillOpacity = (id: string) =>
    setStills((prev) => {
      const next = new Map(prev);
      next.set(id, prev.get(id) === "full" ? "dim" : "full");
      return next;
    });

  const goTo = useCallback(
    (index: number) => {
      setActiveIndex(Math.max(0, Math.min(index, clips.length - 1)));
    },
    [clips.length]
  );

  useTeleprompterActions({
    advance: () => goTo(activeIndex + 1),
    back: () => goTo(activeIndex - 1),
    // Inert, as in the Beats view: there is no crawl here to start or stop.
    togglePlay: () => {},
    reset: () => goTo(0),
  });

  // Keep the active clip pinned to the read line.
  useEffect(() => {
    const clip = clips[activeIndex];
    const scroller = scrollRef.current;
    const row = clip ? rowRefs.current.get(clip.id) : undefined;
    if (!scroller || !row) return;
    const anchor = (scroller.clientHeight * TYPE.readLine) / 100;
    scroller.scrollTo({
      top: row.offsetTop - anchor + row.clientHeight / 2,
      behavior: "smooth",
    });
  }, [activeIndex, clips]);

  const base = textStyle();
  const chapterSize = TYPE.fontSize * TYPE.animaticChapterScale;

  return (
    <div className="relative h-full w-full overflow-hidden bg-black">
      <div
        ref={scrollRef}
        className="h-full w-full overflow-y-scroll [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <div
          className="mx-auto"
          style={{
            // Set in the glass's own type, so `ch` means what it means in the
            // script's crawl: a line here is exactly a line of the script.
            ...base,
            width: `calc(${TYPE.measure}ch + ${TYPE.animaticGutter}em)`,
            maxWidth: "92vw",
            paddingTop: `${TYPE.readLine}vh`,
            paddingBottom: "70vh",
          }}
        >
          {lines.map((line) => {
            if (line.type === "chapter") {
              return (
                <div
                  key={line.id}
                  className="mt-10 mb-5 border-b border-white/15 pb-1 first:mt-0"
                  style={{
                    ...base,
                    fontSize: `${chapterSize}px`,
                    color: TYPE.cueColor,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                  }}
                >
                  {line.name}
                  <Comments comments={line.comments} />
                </div>
              );
            }

            const still = stills.get(line.id);
            return (
              <div
                key={line.id}
                ref={(el) => {
                  if (el) rowRefs.current.set(line.id, el);
                  else rowRefs.current.delete(line.id);
                }}
                // Clicking a clip moves the spotlight — the popup rarely has
                // OS focus for the Stream Deck's keys while you film — and
                // shows or hides its still.
                onClick={() => {
                  if (hasSelectedText()) return;
                  setActiveIndex(line.position - 1);
                  toggleStill(line.id);
                }}
                className="relative mb-8 flex cursor-pointer"
              >
                {still && (
                  <Still
                    clipMockupId={line.id}
                    position={line.position}
                    state={still}
                    onToggle={() => toggleStillOpacity(line.id)}
                  />
                )}
                {/* The gutter is sized in body `em`, the number inside it at
                    the cue size, on the first line's own line box. */}
                <span
                  className="shrink-0"
                  style={{ width: `${TYPE.animaticGutter}em` }}
                  aria-label={`Clip ${line.position}`}
                >
                  <span
                    className="tabular-nums"
                    style={{
                      ...cueStyle(),
                      fontStyle: "normal",
                      lineHeight: `${TYPE.fontSize * TYPE.lineHeight}px`,
                    }}
                  >
                    {line.position}
                  </span>
                </span>
                <div className="min-w-0 flex-1">
                  {line.line}
                  <Comments comments={line.comments} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
