/**
 * Nests a flat run of glass rows (Script blocks, Animatic lines) into the
 * sections their headings open, so the views can pin the current heading with
 * nothing but CSS `position: sticky`.
 *
 * A sticky heading stays pinned only while its containing block — its parent —
 * is on screen. So each H2 is the first child of a wrapper that holds
 * everything up to the next H2, and each H3 the first child of a wrapper
 * (inside its H2's) that holds everything up to the next H3 or H2. Scroll past
 * the wrapper's end and the heading goes with it: a new H2 pushes the old one
 * (and its H3) off, a new H3 pushes the old H3 off. No scroll listener, no
 * state.
 *
 * Shared by the Script crawl and the Animatic view, so both pin the same way.
 */

/**
 * What a row is to the nesting: "h2" opens a section, "h3" a subsection,
 * "break" closes whatever is open and stays a plain row (an H1, which sits
 * above the H2s and is never pinned), and null is an ordinary row.
 */
export type HeadingRank = "h2" | "h3" | "break" | null;

export type HeadingNode<T> =
  | { readonly kind: "row"; readonly row: T }
  | {
      readonly kind: "section";
      readonly rank: "h2" | "h3";
      readonly heading: T;
      readonly children: readonly HeadingNode<T>[];
    };

type OpenSection<T> = {
  kind: "section";
  rank: "h2" | "h3";
  heading: T;
  children: HeadingNode<T>[];
};

export function nestHeadingSections<T>(
  rows: readonly T[],
  rankOf: (row: T) => HeadingRank
): HeadingNode<T>[] {
  const root: HeadingNode<T>[] = [];
  let h2: OpenSection<T> | null = null;
  let h3: OpenSection<T> | null = null;

  const current = () => (h3 ?? h2)?.children ?? root;

  for (const row of rows) {
    const rank = rankOf(row);
    if (rank === "h2") {
      h2 = { kind: "section", rank: "h2", heading: row, children: [] };
      h3 = null;
      root.push(h2);
    } else if (rank === "h3") {
      h3 = { kind: "section", rank: "h3", heading: row, children: [] };
      // An H3 before any H2 still pins, on its own, at the top.
      (h2?.children ?? root).push(h3);
    } else if (rank === "break") {
      h2 = null;
      h3 = null;
      root.push({ kind: "row", row });
    } else {
      current().push({ kind: "row", row });
    }
  }
  return root;
}
