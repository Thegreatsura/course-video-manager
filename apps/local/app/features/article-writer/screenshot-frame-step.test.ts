import { describe, expect, it } from "vitest";
import { stepScreenshotFrame } from "./screenshot-frame-step";

describe("stepScreenshotFrame", () => {
  // Clip 2 of 3 runs 10s–20s; the step is 2.5s.
  const press = (time: number, direction: 1 | -1, clipIndex = 2) =>
    stepScreenshotFrame({
      time,
      clipStart: 10,
      clipEnd: 20,
      clipIndex,
      clipCount: 3,
      step: 2.5,
      direction,
    });

  it("steps inside the clip, clamping to its edges first", () => {
    expect([press(15, -1), press(15, 1), press(11, -1), press(19, 1)]).toEqual([
      { type: "seek", time: 12.5 },
      { type: "seek", time: 17.5 },
      { type: "seek", time: 10 },
      { type: "seek", time: 20 },
    ]);
  });

  it("crosses into the neighbouring clip from an edge, and stops at the ends", () => {
    expect([
      press(10, -1),
      press(20, 1),
      press(10, -1, 1),
      press(20, 1, 3),
    ]).toEqual([
      { type: "change-clip", newIndex: 1, landAt: "end" },
      { type: "change-clip", newIndex: 3, landAt: "start" },
      null,
      null,
    ]);
  });
});
