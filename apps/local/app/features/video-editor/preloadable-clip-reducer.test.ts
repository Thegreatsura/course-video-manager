import { describe, expect, it } from "vitest";
import { ReducerTester } from "@/test-utils/reducer-tester";
import {
  createInitialPreloadableClipState,
  preloadableClipReducer,
} from "./preloadable-clip-reducer";

describe("preloadableClipReducer", () => {
  it("a preloading Clip parks at its start once, however many frames report it got there", () => {
    const tester = new ReducerTester(
      preloadableClipReducer,
      createInitialPreloadableClipState()
    );

    const state = tester
      .send({ type: "clip-preloaded", at: 12.5 })
      .send({ type: "clip-preloaded", at: 12.5 })
      .getState();

    expect(state.preload).toBe("finished");
    expect(tester.getEffects()).toEqual([
      { type: "park-video", at: 12.5 },
      { type: "report-preload-complete" },
    ]);
  });

  it("the Overlay playhead follows the video, through the preload and after it", () => {
    const tester = new ReducerTester(
      preloadableClipReducer,
      createInitialPreloadableClipState()
    );

    tester
      .send({ type: "playhead-moved", clipTime: -0.05 })
      .send({ type: "clip-preloaded", at: 3 })
      .send({ type: "playhead-moved", clipTime: 0 })
      .send({ type: "playhead-moved", clipTime: 1.25 });

    expect(tester.getState()).toEqual({
      preload: "finished",
      overlayTime: 1.25,
    });
    expect(tester.getEffects()).toEqual([
      { type: "park-video", at: 3 },
      { type: "report-preload-complete" },
    ]);
  });
});
