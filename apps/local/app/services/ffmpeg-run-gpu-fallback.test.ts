import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NodeContext } from "@effect/platform-node";
import { Effect, Layer, Logger } from "effect";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  BITEXACT_ARGS,
  LANDSCAPE_VIDEO_CPU_FALLBACK_ENCODE_ARGS,
  LANDSCAPE_VIDEO_ENCODE_ARGS,
  landscapeCpuFallbackArgs,
} from "./ffmpeg-error";
import { runFfmpegWithProgress } from "./ffmpeg-run";
import { SidecarContextTest } from "./sidecar-context";

// What ffmpeg printed in the real failure (Publish Job 859b8689): the CUDA
// context would not come up, so NVENC could not open at all.
const CUDA_UNAVAILABLE_STDERR = [
  "[matroska,webm @ 0x5b9342f6c600] Read error at pos. 13112062 (0xc812fe)",
  "[h264_nvenc @ 0x5b9380c58280] dl_fn->cuda_dl->cuCtxCreate(&ctx->cu_context_internal, 0, cu_device) failed -> CUDA_ERROR_UNKNOWN: unknown error",
  "[h264_nvenc @ 0x5b9380c58280] No capable devices found",
  "[vost#0:0/h264_nvenc @ 0x5b9380c57e80] Error while opening encoder - maybe incorrect parameters such as bit_rate, rate, width or height.",
  "Conversion failed!",
].join("\n");

const landscapePass = (output: string) => [
  "-y",
  "-i",
  "in.mkv",
  ...LANDSCAPE_VIDEO_ENCODE_ARGS,
  "-c:a",
  "aac",
  ...BITEXACT_ARGS,
  output,
];

describe("landscapeCpuFallbackArgs", () => {
  it("swaps only the encoder block for libx264 when NVENC could not open", () => {
    const args = landscapePass("out.mp4");
    expect(landscapeCpuFallbackArgs(args, CUDA_UNAVAILABLE_STDERR)).toEqual([
      "-y",
      "-i",
      "in.mkv",
      ...LANDSCAPE_VIDEO_CPU_FALLBACK_ENCODE_ARGS,
      "-c:a",
      "aac",
      ...BITEXACT_ARGS,
      "out.mp4",
    ]);
  });

  it("does not fall back for a failure that is not the GPU", () => {
    expect(
      landscapeCpuFallbackArgs(
        landscapePass("out.mp4"),
        "in.mkv: No such file or directory"
      )
    ).toBeNull();
  });

  it("does not touch a pass that never asked for NVENC", () => {
    expect(
      landscapeCpuFallbackArgs(
        ["-i", "in.mkv", "-c:v", "libx264", "out.mp4"],
        CUDA_UNAVAILABLE_STDERR
      )
    ).toBeNull();
  });
});

// A stand-in `ffmpeg` on PATH: any run that asks for h264_nvenc fails exactly
// as the GPU-less machine did; any other run records its args and succeeds.
describe("runFfmpegWithProgress — GPU fallback", () => {
  let dir: string;
  let originalPath: string | undefined;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "ffmpeg-gpu-fallback-"));
    fs.writeFileSync(
      path.join(dir, "nvenc-stderr.txt"),
      CUDA_UNAVAILABLE_STDERR
    );
    fs.writeFileSync(
      path.join(dir, "ffmpeg"),
      `#!/bin/sh
echo "$*" >> "${dir}/runs.txt"
case " $* " in
  *" h264_nvenc "*) cat "${dir}/nvenc-stderr.txt" >&2; exit 187 ;;
esac
exit 0
`,
      { mode: 0o755 }
    );
    originalPath = process.env.PATH;
    process.env.PATH = `${dir}${path.delimiter}${originalPath ?? ""}`;
  });

  afterEach(() => {
    process.env.PATH = originalPath;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const run = (args: string[]) => {
    const warnings: string[] = [];
    const logs: string[][] = [];
    const logger = Logger.make(({ logLevel, message }) => {
      if (logLevel._tag === "Warning")
        warnings.push(String([message].flat()[0]));
    });
    return Effect.runPromise(
      runFfmpegWithProgress({
        args,
        totalDurationSeconds: 1,
        onProgress: undefined,
        onLog: (info) => logs.push(info.command),
        errorPrefix: "Failed to create concatenated video",
      }).pipe(
        Effect.either,
        Effect.provide(
          Layer.mergeAll(
            NodeContext.layer,
            SidecarContextTest,
            Logger.replace(Logger.defaultLogger, logger)
          )
        )
      )
    ).then((result) => ({ result, warnings, logs }));
  };

  const runs = () =>
    fs.readFileSync(path.join(dir, "runs.txt"), "utf8").trim().split("\n");

  it("re-runs a landscape pass on libx264 when h264_nvenc cannot open, and warns", async () => {
    const { result, warnings, logs } = await run(landscapePass("out.mp4"));

    expect(result._tag).toBe("Right");
    expect(runs()).toHaveLength(2);
    expect(runs()[0]).toContain("h264_nvenc");
    expect(runs()[1]).toContain("-c:v libx264 -preset medium -crf 18");
    expect(runs()[1]).not.toContain("h264_nvenc");
    expect(runs()[1]).toContain("out.mp4");
    expect(warnings).toEqual([
      expect.stringContaining("h264_nvenc could not open"),
    ]);
    // Both commands reach the per-video log, so it shows what really ran.
    expect(logs).toHaveLength(2);
  });

  it("fails without a fallback when the failure is not the GPU", async () => {
    fs.writeFileSync(
      path.join(dir, "ffmpeg"),
      `#!/bin/sh
echo "$*" >> "${dir}/runs.txt"
echo "in.mkv: No such file or directory" >&2
exit 1
`,
      { mode: 0o755 }
    );
    const { result, warnings } = await run(landscapePass("out.mp4"));

    expect(result._tag).toBe("Left");
    expect(runs()).toHaveLength(1);
    expect(warnings).toEqual([]);
  });
});
