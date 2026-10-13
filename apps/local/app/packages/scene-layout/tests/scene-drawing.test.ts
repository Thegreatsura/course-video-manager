import { describe, expect, it } from "vitest";
import {
  CANVASES,
  drawInstructions,
  drawnSources,
  LAYOUT_VERSIONS,
  SCENES,
  sceneFilterGraph,
} from "@/packages/scene-layout";

const landscapeSources = {
  screen: { width: 2560, height: 1440 },
  camera: { width: 3840, height: 2160 },
};

const shortSources = {
  screen: { width: 1920, height: 1080 },
  camera: { width: 3840, height: 2160 },
};

describe("drawInstructions", () => {
  it("leaves out what falls entirely off the Landscape canvas", () => {
    expect(
      drawInstructions("No Face", landscapeSources).map((i) => i.source)
    ).toEqual(["screen"]);
    expect(
      drawInstructions("Camera", landscapeSources).map((i) => i.source)
    ).toEqual(["camera"]);
  });

  it("draws a Short on its own 1080x1920 canvas with its own version", () => {
    expect(CANVASES.short).toEqual({ width: 1080, height: 1920 });
    expect(LAYOUT_VERSIONS.short).toBe(3);
  });

  it("fills the Short Camera scene with the camera's centre crop, needing no screen", () => {
    expect(
      drawInstructions("Camera", { camera: shortSources.camera }, "short")
    ).toEqual([
      {
        source: "camera",
        sx: 1298,
        sy: 0,
        sw: 1212,
        sh: 2154,
        dx: 0,
        dy: 0,
        dw: 1080,
        dh: 1920,
      },
    ]);
  });

  it("draws the Short Code scene as the screen's left square, 1:1, with the camera band below", () => {
    expect(drawInstructions("Code", shortSources, "short")).toEqual([
      {
        source: "screen",
        sx: 0,
        sy: 0,
        sw: 1080,
        sh: 1080,
        dx: 0,
        dy: 0,
        dw: 1080,
        dh: 1080,
      },
      {
        source: "camera",
        sx: 789,
        sy: 92,
        sw: 2168,
        sh: 1687,
        dx: 0,
        dy: 1080,
        dw: 1080,
        dh: 840,
      },
    ]);
  });

  it("draws the Short No Face scene as the screen's left square, black below", () => {
    expect(drawInstructions("No Face", shortSources, "short")).toEqual([
      {
        source: "screen",
        sx: 0,
        sy: 0,
        sw: 1080,
        sh: 1080,
        dx: 0,
        dy: 0,
        dw: 1080,
        dh: 1080,
      },
    ]);
  });

  it.each([
    [
      "the 1080x1080 Spacedesk display (all of it)",
      { width: 1080, height: 1080 },
      1080,
    ],
    ["its 540x540 preview", { width: 540, height: 540 }, 540],
    [
      "the 960x540 preview of a 1920x1080 one",
      { width: 960, height: 540 },
      540,
    ],
  ])(
    "draws the left square of %s as a Short's screen, 1:1 at the top, in Code and No Face",
    (_, screen, side) => {
      for (const scene of ["Code", "No Face"] as const)
        expect(
          drawInstructions(scene, { ...shortSources, screen }, "short")[0]
        ).toEqual({
          source: "screen",
          sx: 0,
          sy: 0,
          sw: side,
          sh: side,
          dx: 0,
          dy: 0,
          dw: 1080,
          dh: 1080,
        });
    }
  );

  it("refuses to draw a scene without a source it draws", () => {
    expect(() =>
      drawInstructions("Code", { camera: shortSources.camera }, "short")
    ).toThrow(/screen/);
  });
});

describe("drawnSources", () => {
  const run = (...scenes: (typeof SCENES)[number][]) =>
    scenes.map((scene) => ({ scene }));

  it("says the Short Camera scene draws the camera alone", () => {
    expect(drawnSources(run("Camera"), "short")).toEqual(["camera"]);
  });

  it("says the Short Code scene draws both", () => {
    expect(drawnSources(run("Code"), "short")).toEqual(["screen", "camera"]);
  });

  it("says Landscape Camera draws the camera alone, its screen item being off-canvas", () => {
    expect(drawnSources(run("Camera"))).toEqual(["camera"]);
  });

  it("joins what every segment of a run draws", () => {
    expect(drawnSources(run("Camera", "No Face"), "short")).toEqual([
      "screen",
      "camera",
    ]);
  });
});

describe("sceneFilterGraph", () => {
  it.each([
    ["landscape", landscapeSources],
    ["short", shortSources],
  ] as const)(
    "places every %s item where the canvas draws it",
    (format, sources) => {
      for (const scene of SCENES) {
        const graph = sceneFilterGraph({
          segments: [{ scene, startSeconds: 0, endSeconds: 1 }],
          format,
        });
        const { width, height } = CANVASES[format];
        expect(graph).toContain(`color=c=black:s=${width}x${height}`);
        const instructions = drawInstructions(scene, sources, format);
        expect(graph.match(/overlay=/g)).toHaveLength(instructions.length);
        for (const i of instructions) {
          expect(graph).toContain(`scale=${i.dw}:${i.dh}`);
          expect(graph).toContain(`overlay=x=${i.dx}:y=${i.dy}`);
        }
      }
    }
  );

  it("consumes only the inputs it is given when the run draws no screen", () => {
    const graph = sceneFilterGraph({
      segments: [{ scene: "Camera", startSeconds: 0, endSeconds: 1 }],
      inputs: { camera: "0:v" },
      format: "short",
    });
    expect(graph).not.toContain("1:v");
    expect(graph).not.toContain("nullsink");
  });

  it("refuses to leave out an input the run draws", () => {
    expect(() =>
      sceneFilterGraph({
        segments: [{ scene: "Code", startSeconds: 0, endSeconds: 1 }],
        inputs: { camera: "0:v" },
        format: "short",
      })
    ).toThrow(/screen/);
  });
});
