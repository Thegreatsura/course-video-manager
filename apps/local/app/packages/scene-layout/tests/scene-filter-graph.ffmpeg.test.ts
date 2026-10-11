import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { sceneFilterGraph, type SceneSegment } from "@/packages/scene-layout";

/**
 * Renders the real graph with the real ffmpeg over tiny lavfi stand-ins for
 * the recordings (no device, no capture): a red screen at 60 fps and a green
 * camera at 29.97, and reads known pixels back. Skipped where there is no
 * ffmpeg.
 */
const hasFfmpeg = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

const W = 1920;
const H = 1080;
const RED = [255, 0, 0] as const;
const GREEN = [0, 255, 0] as const;
const BLACK = [0, 0, 0] as const;

/** Every frame of the composite, as rgb24 buffers. */
const render = (segments: SceneSegment[]): Buffer[] => {
  const out = execFileSync(
    "ffmpeg",
    [
      "-hide_banner",
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=red:s=320x180:r=60:d=1",
      "-f",
      "lavfi",
      "-i",
      "color=c=lime:s=384x216:r=30000/1001:d=1",
      "-filter_complex",
      sceneFilterGraph({ segments }),
      "-map",
      "[v]",
      "-pix_fmt",
      "rgb24",
      "-f",
      "rawvideo",
      "-",
    ],
    { maxBuffer: 1 << 30 }
  );
  const size = W * H * 3;
  return Array.from({ length: out.length / size }, (_, i) =>
    out.subarray(i * size, (i + 1) * size)
  );
};

const pixel = (frame: Buffer, x: number, y: number) => {
  const o = (y * W + x) * 3;
  return [frame[o]!, frame[o + 1]!, frame[o + 2]!];
};

const near = (actual: number[], expected: readonly number[]) =>
  actual.every((v, i) => Math.abs(v - expected[i]!) <= 24);

describe.skipIf(!hasFfmpeg)("the scene filter graph in ffmpeg", () => {
  it.each([
    // Camera: the camera fills the canvas from (2,2); the 2px rim stays black.
    [
      "Camera",
      [
        [960, 540, GREEN],
        [0, 0, BLACK],
      ],
    ],
    // Code: the screen fills the canvas, the face cam sits bottom right.
    [
      "Code",
      [
        [100, 100, RED],
        [1700, 800, GREEN],
        [1400, 800, RED],
      ],
    ],
    // No Face: only the screen.
    [
      "No Face",
      [
        [100, 100, RED],
        [1700, 800, RED],
      ],
    ],
  ] as const)("draws %s", (scene, probes) => {
    const frames = render([{ scene, startSeconds: 0, endSeconds: 0.1 }]);
    expect(frames).toHaveLength(6);
    for (const [x, y, colour] of probes)
      expect(near(pixel(frames[3]!, x, y), colour)).toBe(true);
  });

  it("draws a scene change mid-Clip as two runs of 60 fps frames", () => {
    const frames = render([
      { scene: "Camera", startSeconds: 0.2, endSeconds: 0.3 },
      { scene: "No Face", startSeconds: 0.3, endSeconds: 0.5 },
    ]);
    expect(frames).toHaveLength(18);
    expect(near(pixel(frames[2]!, 960, 540), GREEN)).toBe(true);
    expect(near(pixel(frames[12]!, 960, 540), RED)).toBe(true);
  });
});
