import { describe, expect, it } from "vitest";
import {
  drawInstructions,
  SCENES,
  sceneFilterGraph,
} from "@/packages/scene-layout";

const sources = {
  screen: { width: 2560, height: 1440 },
  camera: { width: 3840, height: 2160 },
};

describe("drawInstructions", () => {
  it("crops the Code scene's face cam out of the camera and puts it bottom right", () => {
    expect(drawInstructions("Code", sources)).toEqual([
      {
        source: "screen",
        sx: 0,
        sy: 0,
        sw: 2560,
        sh: 1440,
        dx: 0,
        dy: 0,
        dw: 1920,
        dh: 1080,
      },
      {
        source: "camera",
        sx: 1224,
        sy: 0,
        sw: 1424,
        sh: 2076,
        dx: 1429,
        dy: 364,
        dw: 491,
        dh: 716,
      },
    ]);
  });

  it("leaves out what falls entirely off the canvas", () => {
    expect(drawInstructions("No Face", sources).map((i) => i.source)).toEqual([
      "screen",
    ]);
    expect(drawInstructions("Camera", sources).map((i) => i.source)).toEqual([
      "camera",
    ]);
  });
});

describe("sceneFilterGraph agrees with drawInstructions", () => {
  it.each(SCENES)(
    "places every item of %s where the canvas draws it",
    (scene) => {
      const graph = sceneFilterGraph({
        segments: [{ scene, startSeconds: 0, endSeconds: 1 }],
      });
      const instructions = drawInstructions(scene, sources);
      expect(graph.match(/overlay=/g)).toHaveLength(instructions.length);
      for (const i of instructions) {
        expect(graph).toContain(`scale=${i.dw}:${i.dh}`);
        expect(graph).toContain(`overlay=x=${i.dx}:y=${i.dy}`);
      }
    }
  );
});
