/**
 * How tall each pinned heading bar is, as the browser last laid it out.
 *
 * Pinned bars wrap onto as many lines as their heading needs, so the H2 has to
 * pin under the H1's real height and the H3 under both. CSS can't offset one
 * sticky element by another's height, so the views measure the H1 and H2 bars
 * (a `ResizeObserver` in `sticky-heading.tsx`) and report what they saw here;
 * each section then hands its heading's height down to the bars nested inside
 * it as a CSS variable.
 */
export namespace stickyHeightsReducer {
  export interface State {
    /** Border-box height in px, by heading id. Absent until first measured. */
    readonly heights: Readonly<Record<string, number>>;
  }

  export type Action = {
    /** The browser laid these heading bars out at these heights. */
    type: "headings-resized";
    sizes: readonly { id: string; height: number }[];
  };
}

export function createInitialStickyHeightsState(): stickyHeightsReducer.State {
  return { heights: {} };
}

export function stickyHeightsReducer(
  state: stickyHeightsReducer.State,
  action: stickyHeightsReducer.Action
): stickyHeightsReducer.State {
  switch (action.type) {
    case "headings-resized": {
      const changed = action.sizes.filter(
        ({ id, height }) => state.heights[id] !== height
      );
      // The same state back, so React skips the re-render: the observer
      // reports every bar it watches on each (re)subscribe.
      if (changed.length === 0) return state;
      const heights = { ...state.heights };
      for (const { id, height } of changed) heights[id] = height;
      return { heights };
    }
  }
}
