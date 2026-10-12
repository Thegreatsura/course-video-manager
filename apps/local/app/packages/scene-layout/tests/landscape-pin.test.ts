import { describe, expect, it } from "vitest";
import {
  CANVAS,
  CANVASES,
  drawInstructions,
  LAYOUT_VERSION,
  LAYOUT_VERSIONS,
  SCENES,
  sceneFilterGraph,
} from "@/packages/scene-layout";

/**
 * Landscape is pinned byte for byte: its draw instructions, filtergraph and
 * version feed every Landscape CVM-recorder export and its Export Hash, so a
 * change here makes them all go stale. Change these only with a Landscape
 * layout version bump.
 */
const sources = {
  screen: { width: 2560, height: 1440 },
  camera: { width: 3840, height: 2160 },
};

const graphs = {
  Camera: [
    "[0:v]nullsink",
    "[1:v]split=1[camera0]",
    "color=c=black:s=1920x1080:r=60:d=1[base0]",
    "[camera0]trim=start=0:end=1,setpts=PTS-STARTPTS,fps=60,crop=w=iw*1:h=ih*1:x=iw*0:y=ih*0,scale=1920:1080[item0_0]",
    "[base0][item0_0]overlay=x=2:y=2:eof_action=repeat[seg0_0]",
    "[seg0_0]null[seg0]",
    "[seg0]format=yuv420p[v]",
  ].join(";"),
  Code: [
    "[0:v]split=1[screen0]",
    "[1:v]split=1[camera0]",
    "color=c=black:s=1920x1080:r=60:d=1[base0]",
    "[screen0]trim=start=0:end=1,setpts=PTS-STARTPTS,fps=60,crop=w=iw*1:h=ih*1:x=iw*0:y=ih*0,scale=1920:1080[item0_0]",
    "[base0][item0_0]overlay=x=0:y=0:eof_action=repeat[seg0_0]",
    "[camera0]trim=start=0:end=1,setpts=PTS-STARTPTS,fps=60,crop=w=iw*0.370833:h=ih*0.961111:x=iw*0.31875:y=ih*0,scale=491:716[item0_1]",
    "[seg0_0][item0_1]overlay=x=1429:y=364:eof_action=repeat[seg0_1]",
    "[seg0_1]null[seg0]",
    "[seg0]format=yuv420p[v]",
  ].join(";"),
  "No Face": [
    "[0:v]split=1[screen0]",
    "[1:v]nullsink",
    "color=c=black:s=1920x1080:r=60:d=1[base0]",
    "[screen0]trim=start=0:end=1,setpts=PTS-STARTPTS,fps=60,crop=w=iw*1:h=ih*1:x=iw*0:y=ih*0,scale=1920:1080[item0_0]",
    "[base0][item0_0]overlay=x=0:y=0:eof_action=repeat[seg0_0]",
    "[seg0_0]null[seg0]",
    "[seg0]format=yuv420p[v]",
  ].join(";"),
};

describe("the Landscape layout", () => {
  it("stays version 1 on the 1920x1080 canvas", () => {
    expect(LAYOUT_VERSION).toBe(1);
    expect(LAYOUT_VERSIONS.landscape).toBe(1);
    expect(CANVAS).toEqual({ width: 1920, height: 1080 });
    expect(CANVASES.landscape).toEqual(CANVAS);
  });

  it("draws every scene as before", () => {
    expect(drawInstructions("Camera", sources)).toEqual([
      {
        source: "camera",
        sx: 0,
        sy: 0,
        sw: 3840,
        sh: 2160,
        dx: 2,
        dy: 2,
        dw: 1920,
        dh: 1080,
      },
    ]);
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
    expect(drawInstructions("No Face", sources)).toEqual([
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
    ]);
    for (const scene of SCENES)
      expect(drawInstructions(scene, sources, "landscape")).toEqual(
        drawInstructions(scene, sources)
      );
  });

  it.each(SCENES)("filters %s as before", (scene) => {
    const segments = [{ scene, startSeconds: 0, endSeconds: 1 }];
    expect(sceneFilterGraph({ segments })).toBe(graphs[scene]);
    expect(sceneFilterGraph({ segments, format: "landscape" })).toBe(
      graphs[scene]
    );
  });

  it("filters a seeked, relabelled run of scene changes as before", () => {
    expect(
      sceneFilterGraph({
        segments: [
          { scene: "Camera", startSeconds: 2, endSeconds: 3 },
          { scene: "Code", startSeconds: 3, endSeconds: 4.5 },
          { scene: "No Face", startSeconds: 4.5, endSeconds: 6 },
        ],
        inputs: { screen: "2:v", camera: "3:v" },
        inputStartSeconds: 1.5,
        output: "out",
      })
    ).toBe(
      [
        "[2:v]split=2[screen0][screen1]",
        "[3:v]split=2[camera0][camera1]",
        "color=c=black:s=1920x1080:r=60:d=1[base0]",
        "[camera0]trim=start=0.5:end=1.5,setpts=PTS-STARTPTS,fps=60,crop=w=iw*1:h=ih*1:x=iw*0:y=ih*0,scale=1920:1080[item0_0]",
        "[base0][item0_0]overlay=x=2:y=2:eof_action=repeat[seg0_0]",
        "[seg0_0]null[seg0]",
        "color=c=black:s=1920x1080:r=60:d=1.5[base1]",
        "[screen0]trim=start=1.5:end=3,setpts=PTS-STARTPTS,fps=60,crop=w=iw*1:h=ih*1:x=iw*0:y=ih*0,scale=1920:1080[item1_0]",
        "[base1][item1_0]overlay=x=0:y=0:eof_action=repeat[seg1_0]",
        "[camera1]trim=start=1.5:end=3,setpts=PTS-STARTPTS,fps=60,crop=w=iw*0.370833:h=ih*0.961111:x=iw*0.31875:y=ih*0,scale=491:716[item1_1]",
        "[seg1_0][item1_1]overlay=x=1429:y=364:eof_action=repeat[seg1_1]",
        "[seg1_1]null[seg1]",
        "color=c=black:s=1920x1080:r=60:d=1.5[base2]",
        "[screen1]trim=start=3:end=4.5,setpts=PTS-STARTPTS,fps=60,crop=w=iw*1:h=ih*1:x=iw*0:y=ih*0,scale=1920:1080[item2_0]",
        "[base2][item2_0]overlay=x=0:y=0:eof_action=repeat[seg2_0]",
        "[seg2_0]null[seg2]",
        "[seg0][seg1][seg2]concat=n=3:v=1:a=0,format=yuv420p[out]",
      ].join(";")
    );
  });
});
