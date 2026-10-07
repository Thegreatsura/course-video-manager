import { describe, expect, it } from "vitest";
import {
  createInitialStickyHeightsState,
  stickyHeightsReducer,
} from "./sticky-heights-reducer";

describe("stickyHeightsReducer", () => {
  it("keeps each heading's latest height as its bar rewraps", () => {
    let state = createInitialStickyHeightsState();
    state = stickyHeightsReducer(state, {
      type: "headings-resized",
      sizes: [
        { id: "title", height: 30 },
        { id: "alpha", height: 30 },
      ],
    });
    // The glass narrowed: the long H2 now takes two lines.
    state = stickyHeightsReducer(state, {
      type: "headings-resized",
      sizes: [{ id: "alpha", height: 58 }],
    });
    expect(state.heights).toEqual({ title: 30, alpha: 58 });
  });

  // Every re-subscribe reports every bar; re-rendering the whole Script for
  // heights it already has would be wasted work mid-crawl.
  it("returns the same state when nothing changed height", () => {
    const state = stickyHeightsReducer(createInitialStickyHeightsState(), {
      type: "headings-resized",
      sizes: [{ id: "alpha", height: 30 }],
    });
    expect(
      stickyHeightsReducer(state, {
        type: "headings-resized",
        sizes: [{ id: "alpha", height: 30 }],
      })
    ).toBe(state);
  });
});
