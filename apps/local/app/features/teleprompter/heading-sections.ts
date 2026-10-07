/**
 * Nests a flat run of glass rows (Script blocks, Animatic lines) into the
 * sections their headings open, so the views can pin the current headings with
 * CSS `position: sticky`.
 *
 * A sticky heading stays pinned only while its containing block — its parent —
 * is on screen. So each heading is the first child of a wrapper that holds
 * everything up to the next heading of its rank or higher: an H1's holds its
 * H2s, an H2's its H3s. Scroll past the wrapper's end and the heading goes with
 * it: a new H1 pushes the old H1 (and its H2 and H3) off, a new H2 the old H2
 * and its H3, a new H3 the old H3.
 *
 * Shared by the Script crawl and the Animatic view, so both pin the same way.
 */

/** What a row is to the nesting: a heading of a rank, or (null) an ordinary row. */
export type HeadingRank = "h1" | "h2" | "h3" | null;

export type HeadingNode<T> =
  | { readonly kind: "row"; readonly row: T }
  | {
      readonly kind: "section";
      readonly rank: "h1" | "h2" | "h3";
      readonly heading: T;
      readonly children: readonly HeadingNode<T>[];
    };

type OpenSection<T> = {
  kind: "section";
  rank: "h1" | "h2" | "h3";
  heading: T;
  children: HeadingNode<T>[];
};

const DEPTH = { h1: 0, h2: 1, h3: 2 } as const;

export function nestHeadingSections<T>(
  rows: readonly T[],
  rankOf: (row: T) => HeadingRank
): HeadingNode<T>[] {
  const root: HeadingNode<T>[] = [];
  /** The open sections, outermost first. A level can be skipped: an H3 straight under an H1. */
  const open: OpenSection<T>[] = [];

  const current = () => open.at(-1)?.children ?? root;

  for (const row of rows) {
    const rank = rankOf(row);
    if (rank === null) {
      current().push({ kind: "row", row });
      continue;
    }
    // A heading closes every open section of its rank or deeper.
    while (open.length > 0 && DEPTH[open.at(-1)!.rank] >= DEPTH[rank]) {
      open.pop();
    }
    const section: OpenSection<T> = {
      kind: "section",
      rank,
      heading: row,
      children: [],
    };
    current().push(section);
    open.push(section);
  }
  return root;
}
