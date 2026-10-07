/**
 * The pinned heading bars of the glass: the current H1 at the top of the scroll
 * container, the current H2 under it, the current H3 under that. What keeps
 * each one pinned, and what pushes it off, is the section wrapper it sits first
 * in (see `heading-sections.ts`).
 *
 * A bar wraps onto as many lines as its heading needs, so it has no fixed
 * height. Each H1 and H2 section sets its own heading's measured height as a
 * CSS variable (`--sticky-h1-height`, `--sticky-h2-height`); the bars nested
 * inside pin below the sum of whichever their ancestors set. A level that isn't
 * there sets nothing and counts as 0, so an H2 with no H1 above it pins at the
 * very top. The measuring is `useStickyHeadingHeights`.
 */
import {
  useEffect,
  useReducer,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import {
  createInitialStickyHeightsState,
  stickyHeightsReducer,
} from "./sticky-heights-reducer";

export type StickyRank = "h1" | "h2" | "h3";

const H1_HEIGHT = "var(--sticky-h1-height, 0px)";
const H2_HEIGHT = "var(--sticky-h2-height, 0px)";

const TOP: Record<StickyRank, string> = {
  h1: "0px",
  h2: H1_HEIGHT,
  h3: `calc(${H1_HEIGHT} + ${H2_HEIGHT})`,
};

/** A higher level slides over a departing lower one, never under it. */
const Z_INDEX: Record<StickyRank, number> = { h1: 4, h2: 3, h3: 2 };

export function StickyHeading(props: {
  rank: StickyRank;
  /** What `useStickyHeadingHeights` knows this bar by. */
  headingId?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <div
      data-sticky-heading={props.rank}
      data-heading-id={props.headingId}
      style={{
        ...props.style,
        position: "sticky",
        top: TOP[props.rank],
        zIndex: Z_INDEX[props.rank],
        // Opaque, and out to both edges of the glass rather than the column:
        // a full-width instructions panel scrolls under it too.
        background: "black",
        boxShadow: "0 0 0 100vmax black",
        clipPath: "inset(0 -100vmax)",
        // The whole heading, however many lines it takes; a long unbroken
        // word (a path, a URL) breaks rather than running off the glass.
        overflowWrap: "anywhere",
      }}
    >
      {props.children}
    </div>
  );
}

/**
 * Measures the H1 and H2 bars under `container` and returns the style each
 * section spreads onto itself, so the bars nested inside pin below its heading.
 * `structure` is whatever changes when headings come and go (the nested
 * sections), so newly rendered bars get observed.
 */
export function useStickyHeadingHeights(
  container: RefObject<HTMLElement | null>,
  structure: unknown
): (headingId: string, rank: StickyRank) => CSSProperties | undefined {
  const [state, dispatch] = useReducer(
    stickyHeightsReducer,
    undefined,
    createInitialStickyHeightsState
  );

  // A bridge: the browser's layout is the outside world here.
  useEffect(() => {
    const root = container.current;
    if (!root) return;
    const observer = new ResizeObserver((entries) => {
      dispatch({
        type: "headings-resized",
        sizes: entries.flatMap((entry) => {
          const id = (entry.target as HTMLElement).dataset.headingId;
          const box = entry.borderBoxSize[0];
          return id && box ? [{ id, height: box.blockSize }] : [];
        }),
      });
    });
    root
      .querySelectorAll(
        "[data-sticky-heading=h1][data-heading-id], [data-sticky-heading=h2][data-heading-id]"
      )
      .forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [container, structure]);

  return (headingId, rank) => {
    const height = state.heights[headingId];
    if (height === undefined || rank === "h3") return undefined;
    // A custom property is a valid style key that React's types don't model.
    return { [`--sticky-${rank}-height`]: `${height}px` } as CSSProperties;
  };
}
