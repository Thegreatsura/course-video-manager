/**
 * The pinned heading bars of the glass: the current H2 at the top of the
 * scroll container, the current H3 directly under it. Pure CSS — what keeps
 * each one pinned, and what pushes it off, is the section wrapper it sits
 * first in (see `heading-sections.ts`).
 *
 * The H2 bar is one line at a fixed height, `--sticky-h2-height`, which the
 * view sets on its scrolling content; the H3 bar pins at that offset. A view
 * with only one level of heading never needs the variable.
 */
import type { CSSProperties, ReactNode } from "react";

const STICKY_H2_HEIGHT_VAR = "--sticky-h2-height";

/**
 * Sets the pinned H2's height for everything inside: spread it into the style
 * of the view's scrolling content.
 */
export function stickyH2Height(px: number): CSSProperties {
  // A custom property is a valid style key that React's types don't model.
  return { [STICKY_H2_HEIGHT_VAR]: `${px}px` } as CSSProperties;
}

export function StickyHeading(props: {
  rank: "h2" | "h3";
  /** Whether an H3 has an H2 above it to pin under; without one it pins at the very top. */
  underH2?: boolean;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const { rank, underH2 = false } = props;
  return (
    <div
      data-sticky-heading={rank}
      style={{
        ...props.style,
        position: "sticky",
        top: rank === "h3" && underH2 ? `var(${STICKY_H2_HEIGHT_VAR}, 0px)` : 0,
        // The H2 slides over a departing H3, never under it.
        zIndex: rank === "h2" ? 3 : 2,
        // Opaque, and out to both edges of the glass rather than the column:
        // a full-width instructions panel scrolls under it too.
        background: "black",
        boxShadow: "0 0 0 100vmax black",
        clipPath: "inset(0 -100vmax)",
        // One line, so the H2's height is known and the H3 can sit under it.
        display: "flex",
        alignItems: "center",
        whiteSpace: "nowrap",
        overflow: "hidden",
        ...(rank === "h2" ? { height: `var(${STICKY_H2_HEIGHT_VAR})` } : {}),
      }}
    >
      <span
        style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}
      >
        {props.children}
      </span>
    </div>
  );
}
