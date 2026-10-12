/**
 * The script on the glass, in a plain scroll container.
 *
 * It scrolls rather than paging because the current H1, H2 and H3 pin at the
 * top with CSS `position: sticky` (see `heading-sections.ts`), and sticky only
 * follows a scroll. Nothing moves it on its own: the mouse wheel scrolls it
 * directly, which is the fastest way to reach a particular line between takes,
 * and the Stream Deck nudges it forward or back, or returns it to the top.
 */
import { useMemo, useRef } from "react";
import { ScriptCodeBlock } from "./script-code-block";
import { nestHeadingSections, type HeadingNode } from "./heading-sections";
import {
  StickyHeading,
  useStickyHeadingHeights,
  type StickyRank,
} from "./sticky-heading";
import { useTeleprompterActions } from "./use-teleprompter-actions";
import { ScriptMarkdown } from "./script-markdown";
import { parseScriptBlocks, type ScriptBlock } from "./script-blocks";
import { TYPE, textStyle } from "./teleprompter-settings";

export function TeleprompterCrawl(props: { blocks: ScriptBlock[] }) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  /** Just the prose, for measuring the pinned headings. Excludes the runway. */
  const proseRef = useRef<HTMLDivElement>(null);

  const sections = useMemo(
    () => nestHeadingSections(props.blocks, headingRank),
    [props.blocks]
  );

  const sectionStyle = useStickyHeadingHeights(proseRef, sections);

  // One nudge ≈ three lines, which is about a sentence at these settings.
  const nudge = TYPE.fontSize * TYPE.lineHeight * 3;

  const scrollBy = (top: number) =>
    scrollerRef.current?.scrollBy({ top, behavior: "smooth" });

  useTeleprompterActions({
    advance: () => scrollBy(nudge),
    back: () => scrollBy(-nudge),
    reset: () => scrollerRef.current?.scrollTo({ top: 0 }),
  });

  return (
    <div className="relative h-full w-full overflow-hidden bg-black">
      <div
        ref={scrollerRef}
        data-crawl-scroller
        className="absolute inset-0 overflow-y-auto [scrollbar-width:none]"
      >
        <div
          className="mx-auto"
          style={{
            ...textStyle(),
            width: `${TYPE.measure}ch`,
            maxWidth: "92vw",
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
            <SectionsView nodes={sections} sectionStyle={sectionStyle} />
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
/** Pinned headings dim a step per level, so the H1 reads as the outermost. */
const HEADING_COLOR: Record<StickyRank, string> = {
  h1: "var(--color-neutral-300)",
  h2: "var(--color-neutral-400)",
  h3: "var(--color-neutral-500)",
};

/** H1, H2 and H3 pin, each under the levels above it; H4 and below flow. */
function headingRank(block: ScriptBlock) {
  if (block.kind !== "heading") return null;
  if (block.level === 1) return "h1";
  if (block.level === 2) return "h2";
  if (block.level === 3) return "h3";
  return null;
}

/**
 * The script's blocks, each H1, H2 and H3 wrapping the blocks up to the next
 * of its rank or higher so its heading stays pinned exactly that long.
 */
function SectionsView(props: {
  nodes: readonly HeadingNode<ScriptBlock>[];
  sectionStyle: ReturnType<typeof useStickyHeadingHeights>;
}) {
  return props.nodes.map((node) => {
    if (node.kind === "row") {
      return <BlockView key={node.row.id} block={node.row} />;
    }
    return (
      <section
        key={node.heading.id}
        className="mt-12"
        style={props.sectionStyle(node.heading.id, node.rank)}
      >
        <StickyHeading
          rank={node.rank}
          headingId={node.heading.id}
          style={{
            marginBottom: "1.5rem",
            paddingBlock: "0.4em",
            // On a narrow glass the centred column starts left of the Video
            // length, top left of the glass, and the pinned title runs under
            // it. Pad the title in until its left edge shares the timecode's
            // (`left-24` in `video-length.tsx`); `100%` is the column's width,
            // so `(100vw - 100%) / 2` is where the column starts.
            paddingLeft: "max(0px, calc(6rem - (100vw - 100%) / 2))",
            fontSize: `${HEADING_SIZE}px`,
            lineHeight: 1.35,
            fontWeight: 600,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: HEADING_COLOR[node.rank],
          }}
        >
          <ScriptMarkdown>{node.heading.text}</ScriptMarkdown>
        </StickyHeading>
        <SectionsView nodes={node.children} sectionStyle={props.sectionStyle} />
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
  // below; the H1s, H2s and H3s are pinned by `SectionsView`.
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
