import { describe, expect, it } from "vitest";
import {
  CENTERING_DEFAULTS,
  getCentringInsets,
} from "./diagram-centering-settings";
import { diagramFrameOf } from "./diagram-frame";

describe("the Diagram Frame", () => {
  it("is the full-screen playground's safe area, as fractions of the screen", () => {
    // Full screen on the 1920x1080 DELL, sidebar hidden: the canvas is the
    // whole window.
    const viewport = { x: 0, y: 0, w: 1920, h: 1080 };
    const insets = getCentringInsets(
      CENTERING_DEFAULTS,
      "landscape",
      viewport,
      1920
    );
    const safeArea = {
      x: viewport.x + insets.left,
      y: viewport.y + insets.top,
      w: viewport.w - insets.left - insets.right,
      h: viewport.h - insets.top - insets.bottom,
    };

    expect(diagramFrameOf(safeArea, 1920, 1080)).toEqual({
      x: 150 / 1920,
      y: 120 / 1080,
      w: 1128 / 1920,
      h: 840 / 1080,
    });
  });
});
