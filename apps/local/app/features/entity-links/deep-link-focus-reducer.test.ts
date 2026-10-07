import { describe, expect, it } from "vitest";
import { ReducerTester } from "@/test-utils/reducer-tester";
import {
  createInitialDeepLinkFocusState,
  deepLinkFocusReducer,
} from "./deep-link-focus-reducer";

type Candidate = deepLinkFocusReducer.Candidate;

const clipLink = { type: "clip", id: "db-2" } as const;

// The Video editor's case: Clips known by frontend id, linked by database id.
const clips: Candidate[] = [
  { type: "clip", id: "db-1", key: "fe-1" },
  { type: "clip", id: "db-2", key: "fe-2" },
  { type: "chapter", id: "db-2-chapter", key: "fe-3" },
];

const tester = () =>
  new ReducerTester(deepLinkFocusReducer, createInitialDeepLinkFocusState());

describe("deepLinkFocusReducer", () => {
  it("focuses the linked item under the page's own key", () => {
    const t = tester().send({
      type: "deep-link-candidates-loaded",
      target: clipLink,
      candidates: clips,
    });
    expect(t.getState().status).toBe("focused");
    expect(t.getEffects()).toEqual([
      { type: "focus-deep-link-target", candidate: clips[1] },
    ]);
  });

  it("focuses once, so later loads do not steal the selection back", () => {
    const t = tester()
      .send({
        type: "deep-link-candidates-loaded",
        target: clipLink,
        candidates: clips,
      })
      .send({
        type: "deep-link-candidates-loaded",
        target: clipLink,
        candidates: [...clips, { type: "clip", id: "db-9", key: "fe-9" }],
      });
    expect(t.getEffects()).toHaveLength(1);
  });

  it("does nothing on a page whose URL names no item", () => {
    const t = tester().send({
      type: "deep-link-candidates-loaded",
      target: null,
      candidates: clips,
    });
    expect(t.getEffects()).toEqual([]);
  });

  it("says once that an item is missing, then focuses it if it arrives later", () => {
    const later: Candidate = { type: "clip", id: "db-7", key: "fe-7" };
    const target = { type: "clip", id: "db-7" } as const;
    const t = tester()
      .send({ type: "deep-link-candidates-loaded", target, candidates: clips })
      .send({ type: "deep-link-candidates-loaded", target, candidates: clips })
      .send({
        type: "deep-link-candidates-loaded",
        target,
        candidates: [...clips, later],
      });
    expect(t.getState().status).toBe("focused");
    expect(t.getEffects()).toEqual([
      { type: "show-deep-link-notice", reason: "missing", target },
      { type: "focus-deep-link-target", candidate: later },
    ]);
  });

  it("does not focus an archived item, and says why", () => {
    const t = tester().send({
      type: "deep-link-candidates-loaded",
      target: clipLink,
      candidates: [{ type: "clip", id: "db-2", key: "fe-2", archived: true }],
    });
    expect(t.getState().status).toBe("archived");
    expect(t.getEffects()).toEqual([
      { type: "show-deep-link-notice", reason: "archived", target: clipLink },
    ]);
  });

  it("matches on type as well as id", () => {
    const t = tester().send({
      type: "deep-link-candidates-loaded",
      target: { type: "chapter", id: "db-2" },
      candidates: clips,
    });
    expect(t.getState().status).toBe("missing");
  });

  it("starts over when the URL names a new item", () => {
    const other = { type: "clip", id: "db-1" } as const;
    const t = tester()
      .send({
        type: "deep-link-candidates-loaded",
        target: clipLink,
        candidates: clips,
      })
      .send({
        type: "deep-link-candidates-loaded",
        target: other,
        candidates: clips,
      });
    expect(t.getEffects()).toEqual([
      { type: "focus-deep-link-target", candidate: clips[1] },
      { type: "focus-deep-link-target", candidate: clips[0] },
    ]);
  });
});
