/**
 * The script on the glass: a continuous upward crawl.
 *
 * The crawl moves a real scroll container rather than translating the text,
 * because the current H2 and H3 pin at the top with CSS `position: sticky`
 * (see `heading-sections.ts`), and sticky only follows a scroll. Whole pixels
 * go to `scrollTop`; the fraction left over is a `transform`, so a slow crawl
 * still glides instead of stepping a pixel at a time.
 *
 * Speed is expressed in spoken words per minute and converted to pixels per
 * second using the height the prose actually renders at, so changing the type
 * doesn't change the reading pace. The runway below the text is deliberately
 * excluded from that measurement — it's padding, not words, and counting it
 * would inflate the pace on short scripts.
 *
 * The Stream Deck's job here is trim: play/pause, and nudge forward or back
 * when the crawl drifts out of sync with the delivery. The mouse wheel scrolls
 * directly, which is the fastest way to reach a particular line between takes.
 */
import { useEffect, useMemo, useRef } from "react";
import { ScriptCodeBlock } from "./script-code-block";
import { nestHeadingSections, type HeadingNode } from "./heading-sections";
import { StickyHeading, stickyH2Height } from "./sticky-heading";
import { useTeleprompterActions } from "./use-teleprompter-actions";
import { ScriptMarkdown } from "./script-markdown";
import {
  parseScriptBlocks,
  wordCount,
  type ScriptBlock,
} from "./script-blocks";
import { TYPE, textStyle } from "./teleprompter-settings";

export function TeleprompterCrawl(props: {
  blocks: ScriptBlock[];
  /** Crawl speed, in spoken words per minute. */
  wpm: number;
  /**
   * Whether the crawl is rolling. Owned by the session reducer, and only ever
   * started by hand — recording doesn't — see `teleprompter-session.ts`.
   */
  playing: boolean;
  onTogglePlay: () => void;
  onRewind: () => void;
}) {
  /** The scroll container the rAF loop moves. Owns its `scrollTop`. */
  const scrollerRef = useRef<HTMLDivElement>(null);
  /** The sub-pixel remainder. Owns its `transform` — don't set it in JSX. */
  const contentRef = useRef<HTMLDivElement>(null);
  /** Just the prose, for measuring pace. Excludes the runway. */
  const proseRef = useRef<HTMLDivElement>(null);
  const offsetRef = useRef(0);
  const targetRef = useRef(0);
  const playingRef = useRef(props.playing);
  playingRef.current = props.playing;

  // Only prose is spoken: headings and cues are read silently, so counting
  // their words would slow the crawl below the pace actually being delivered.
  const totalWords = useMemo(
    () =>
      props.blocks
        .filter((block) => block.kind === "para" || block.kind === "list")
        .reduce((sum, block) => sum + wordCount(block.text), 0),
    [props.blocks]
  );

  const sections = useMemo(
    () => nestHeadingSections(props.blocks, headingRank),
    [props.blocks]
  );

  // One nudge ≈ three lines, which is about a sentence at these settings.
  const nudge = TYPE.fontSize * TYPE.lineHeight * 3;

  const scrollBy = (delta: number) => {
    targetRef.current = Math.max(0, targetRef.current + delta);
    offsetRef.current = Math.max(0, offsetRef.current + delta);
  };

  useTeleprompterActions({
    advance: () => {
      targetRef.current += nudge;
    },
    back: () => {
      targetRef.current = Math.max(0, targetRef.current - nudge);
    },
    togglePlay: props.onTogglePlay,
    reset: () => {
      targetRef.current = 0;
      offsetRef.current = 0;
      props.onRewind();
    },
  });

  useEffect(() => {
    let raf = 0;
    let last = performance.now();

    const tick = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;

      const el = scrollerRef.current;
      const content = contentRef.current;
      if (el && content) {
        const proseHeight = proseRef.current?.scrollHeight ?? 0;
        // Height per word × words per second = the pace the script reads at.
        const pxPerWord = totalWords > 0 ? proseHeight / totalWords : 0;
        const pxPerSecond = (props.wpm / 60) * pxPerWord;

        if (playingRef.current) targetRef.current += pxPerSecond * dt;
        targetRef.current = Math.max(
          0,
          Math.min(targetRef.current, el.scrollHeight - el.clientHeight)
        );

        // Chase the target rather than snapping to it: a constant-velocity crawl
        // keeps a constant (invisible) lag, while nudges arrive as a smooth ease.
        offsetRef.current += (targetRef.current - offsetRef.current) * 0.18;
        el.scrollTop = Math.floor(offsetRef.current);
        // Whatever the browser actually scrolled to, the transform makes up
        // the rest.
        content.style.transform = `translateY(${el.scrollTop - offsetRef.current}px)`;
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [props.wpm, totalWords]);

  return (
    <div
      className="relative h-full w-full overflow-hidden bg-black"
      onWheel={(e) => scrollBy(e.deltaY)}
    >
      {/* Scrolled by the rAF loop only: the wheel goes through `scrollBy`. */}
      <div
        ref={scrollerRef}
        data-crawl-scroller
        className="absolute inset-0"
        style={{ overflow: "hidden" }}
      >
        <div
          ref={contentRef}
          className="mx-auto will-change-transform"
          style={{
            ...textStyle(),
            width: `${TYPE.measure}ch`,
            maxWidth: "92vw",
            ...stickyH2Height(HEADING_BAR_HEIGHT),
          }}
        >
          {/*
            Everything already spoken fades out — the eye stops chasing it.
            Inside the text rather than laid over it, so the pinned headings
            can sit above the fade; and it is the space above the first line
            too, so the script starts on the read line.
          */}
          <div
            aria-hidden
            className="pointer-events-none bg-gradient-to-b from-black via-black/85 to-transparent"
            style={{
              position: "sticky",
              top: 0,
              zIndex: 1,
              height: `${TYPE.readLine}vh`,
              width: "100vw",
              marginLeft: "calc(50% - 50vw)",
            }}
          />
          <div ref={proseRef}>
            <SectionsView nodes={sections} />
          </div>
          {/* Runway so the last line can still reach the read line. */}
          <div style={{ height: "60vh" }} />
        </div>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black to-transparent" />
    </div>
  );
}

/** Headings are read silently, so they sit well under the body size. */
const HEADING_SIZE = TYPE.fontSize * 0.55;
/** The pinned H2's bar: one line of heading with room around it. */
const HEADING_BAR_HEIGHT = HEADING_SIZE * 2;

/** H2 and H3 pin; an H1 sits above them and closes them; H4 and below flow. */
function headingRank(block: ScriptBlock) {
  if (block.kind !== "heading") return null;
  if (block.level === 1) return "break";
  if (block.level === 2) return "h2";
  if (block.level === 3) return "h3";
  return null;
}

/**
 * The script's blocks, each H2 and H3 wrapping the blocks up to the next of
 * its rank so its heading stays pinned exactly that long.
 */
function SectionsView(props: {
  nodes: readonly HeadingNode<ScriptBlock>[];
  underH2?: boolean;
}) {
  return props.nodes.map((node) => {
    if (node.kind === "row") {
      return <BlockView key={node.row.id} block={node.row} />;
    }
    return (
      <section key={node.heading.id} className="mt-12">
        <StickyHeading
          rank={node.rank}
          underH2={props.underH2}
          style={{
            marginBottom: "1.5rem",
            fontSize: `${HEADING_SIZE}px`,
            fontWeight: 600,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color:
              node.rank === "h2"
                ? "var(--color-neutral-400)"
                : "var(--color-neutral-500)",
          }}
        >
          <ScriptMarkdown>{node.heading.text}</ScriptMarkdown>
        </StickyHeading>
        <SectionsView nodes={node.children} underH2={node.rank === "h2"} />
      </section>
    );
  });
}

/**
 * One block on the glass. An `<instructions>` region holds blocks of its own — its
 * notes, and the commands to copy out of it — so it renders its blocks with
 * this same view, one per line, never run together into one paragraph.
 */
function BlockView(props: { block: ScriptBlock; inInstructions?: boolean }) {
  const { block, inInstructions = false } = props;
  const gap = inInstructions ? "mb-5" : "mb-8";

  if (block.kind === "instructions") {
    return (
      <div
        data-instructions
        className="mb-16 rounded-lg border border-white/10 px-8 py-6"
        style={{
          // Out of the short spoken measure to the full width of the glass:
          // the column is centred, so half its width less half the panel's
          // puts the panel's left edge where the glass starts.
          width: `${TYPE.instructionsWidth}vw`,
          marginLeft: `calc(50% - ${TYPE.instructionsWidth / 2}vw)`,
          fontSize: `${TYPE.instructionsScale}em`,
          fontWeight: 400,
          lineHeight: 1.5,
          color: TYPE.instructionsColor,
        }}
      >
        {parseScriptBlocks(block.text).map((inner) => (
          <BlockView key={inner.id} block={inner} inInstructions />
        ))}
      </div>
    );
  }

  if (block.kind === "code") {
    return (
      <div className={gap}>
        <ScriptCodeBlock code={block.text} nested={inInstructions} />
      </div>
    );
  }

  // Only reached for a heading inside an instructions region or an H4 and
  // below; the H2s and H3s are pinned by `SectionsView`.
  if (block.kind === "heading") {
    return (
      <div
        className="mb-6 mt-12 font-semibold uppercase tracking-widest text-neutral-400"
        style={{ fontSize: `${HEADING_SIZE}px` }}
      >
        <ScriptMarkdown>{block.text}</ScriptMarkdown>
      </div>
    );
  }

  return (
    <div
      className={gap}
      style={inInstructions ? { color: TYPE.instructionsColor } : undefined}
    >
      <ScriptMarkdown>{block.text}</ScriptMarkdown>
    </div>
  );
}
