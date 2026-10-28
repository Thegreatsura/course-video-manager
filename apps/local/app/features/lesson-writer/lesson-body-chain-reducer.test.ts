import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReducerTester } from "@/test-utils/reducer-tester";
import {
  MORE_STORAGE_KEY,
  createInitialLessonBodyChainState,
  lessonBodyChainReducer,
  writeStoredMore,
} from "./lesson-body-chain-reducer";

describe("lessonBodyChainReducer: remembered More?", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("ticking More? persists it, and the next chain starts ticked", () => {
    // Nothing stored yet: off.
    expect(createInitialLessonBodyChainState("v1").more).toBe(false);

    const tester = new ReducerTester(
      lessonBodyChainReducer,
      createInitialLessonBodyChainState("v1")
    ).send({ type: "more-toggled", checked: true });
    expect(tester.getEffects()).toEqual([{ type: "persist-more", more: true }]);

    writeStoredMore(true);
    expect(localStorage.getItem(MORE_STORAGE_KEY)).toBe("true");
    expect(createInitialLessonBodyChainState("v2")).toEqual({
      videoId: "v2",
      more: true,
    });
  });
});
