import { NodeContext } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { clipFrame, clipSource } from "@/packages/clip-source";
import { FFmpegCommandsService } from "./ffmpeg-commands";

/**
 * A screenshot of a CVM-recorder Clip — two inputs, both decoded on the GPU —
 * with the real ffmpeg, from tiny lavfi stand-ins (no device). Then the same
 * with the GPU hidden from CUDA, which is what a machine without one looks
 * like: the still must come out all the same, decoded on the CPU.
 */
const hasFfmpeg = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!hasFfmpeg)("a screenshot, decoded on the GPU", () => {
  const dir = path.join(tmpdir(), `ffmpeg-stills-${process.pid}-${Date.now()}`);
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const screen = path.join(dir, "screen.mkv");
  const camera = path.join(dir, "camera.mkv");
  beforeAll(() => {
    mkdirSync(dir, { recursive: true });
    for (const [out, lavfi] of [
      [screen, "color=c=red:s=320x180:r=60:d=2"],
      [camera, "color=c=lime:s=384x216:r=30000/1001:d=2"],
    ] as const) {
      execFileSync("ffmpeg", [
        "-hide_banner",
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        lavfi,
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        out,
      ]);
    }
  });

  const frame = () =>
    clipFrame(
      clipSource({
        videoFilename: path.join(dir, "mic.mkv"),
        sourceStartTime: 0.5,
        sourceEndTime: 1.8,
        recordingSession: {
          id: "session-1",
          cameraFilePath: camera,
          screenFilePath: screen,
          micFilePath: path.join(dir, "mic.mkv"),
          micOffsetMs: 150,
          format: "landscape" as const,
          screenCaptured: true,
          sceneEvents: [],
        },
      }),
      "first"
    );

  const capture = (name: string) => {
    const out = path.join(dir, name);
    return Effect.runPromise(
      Effect.flatMap(FFmpegCommandsService, (ffmpeg) =>
        ffmpeg.captureFrameAtTime(frame(), out)
      ).pipe(
        Effect.provide(
          Layer.mergeAll(FFmpegCommandsService.Default, NodeContext.layer)
        )
      )
    ).then(() => {
      expect(existsSync(out)).toBe(true);
      return execFileSync("ffprobe", [
        "-v",
        "error",
        "-show_entries",
        "stream=width,height",
        "-of",
        "csv=p=0",
        out,
      ])
        .toString()
        .trim();
    });
  };

  it("captures the frame at 720p", async () => {
    expect(await capture("gpu.jpg")).toBe("1280,720");
  });

  describe("with no usable GPU", () => {
    beforeAll(() => {
      vi.stubEnv("CUDA_VISIBLE_DEVICES", "-1");
    });
    afterAll(() => {
      vi.unstubAllEnvs();
    });

    it("captures it all the same, on the CPU", async () => {
      expect(await capture("cpu.jpg")).toBe("1280,720");
    });
  });
});
