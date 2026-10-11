import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NodeContext } from "@effect/platform-node";
import { FileSystem } from "@effect/platform";
import { ConfigProvider, Effect, Layer } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clipComposite, clipSource } from "@/packages/clip-source";
import { sceneFilterGraph } from "@/packages/scene-layout";
import { FFmpegCommandsService } from "./ffmpeg-commands";
import { FFmpegEncodeService } from "./ffmpeg-encode-commands";
import { SidecarContextTest } from "./sidecar-context";
import { makeVideoExportPasses } from "./video-export-passes";

/**
 * The export pass over a Video of new-recorder Clips, with the real ffmpeg on
 * tiny synthetic stand-ins for a Recording Session (lavfi colours and a sine;
 * no device): a red 60 fps screen, a green 29.97 fps camera, a mono mic.
 * Skipped where there is no ffmpeg.
 */
const hasFfmpeg = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

const lavfi = (dir: string, name: string, source: string, codec: string[]) => {
  const file = path.join(dir, name);
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    source,
    ...codec,
    file,
  ]);
  return file;
};

const probe = (file: string) =>
  JSON.parse(
    execFileSync(
      "ffprobe",
      ["-v", "error", "-show_streams", "-show_format", "-of", "json", file],
      {
        encoding: "utf8",
      }
    )
  ) as {
    streams: Record<string, string | number>[];
    format: { duration: string };
  };

/** The rgb of the pixel at (x, y) (even) of the frame at `t`. */
const pixel = (file: string, t: number, x: number, y: number) => [
  ...execFileSync("ffmpeg", [
    "-v",
    "error",
    "-ss",
    String(t),
    "-i",
    file,
    "-frames:v",
    "1",
    "-vf",
    `crop=2:2:${x}:${y},format=rgb24`,
    "-f",
    "rawvideo",
    "-",
  ]).subarray(0, 3),
];

describe.skipIf(!hasFfmpeg)("exporting a Video of new-recorder Clips", () => {
  const dir = path.join(
    os.tmpdir(),
    `composite-export-${process.pid}-${Date.now()}`
  );
  let commands: string[];
  let output: string;
  const sessionRow = (start: number, end: number) => ({
    videoFilename: path.join(dir, "mic.mkv"),
    sourceStartTime: start,
    sourceEndTime: end,
    recordingSessionId: "session-1",
    sceneOverride: null,
    recordingSession: {
      id: "session-1",
      screenFilePath: path.join(dir, "screen.mkv"),
      cameraFilePath: path.join(dir, "camera.mkv"),
      micFilePath: path.join(dir, "mic.mkv"),
      micOffsetMs: 150,
      // Code until 1.5 s, then Camera.
      sceneEvents: [{ fileTime: 1.5, scene: "Camera" as const }],
    },
  });
  // The first Clip changes scene inside it; the second is all Camera.
  const clips = [sessionRow(0.5, 2), sessionRow(2.5, 3.5)].map((row) => {
    const source = clipSource(row);
    return {
      inputVideo: row.videoFilename,
      startTime: row.sourceStartTime,
      duration: row.sourceEndTime - row.sourceStartTime,
      pauseType: "none" as const,
      zoomType: "none",
      composite: clipComposite(source),
    };
  });

  beforeAll(async () => {
    fs.mkdirSync(dir, { recursive: true });
    const h264 = ["-c:v", "libx264", "-pix_fmt", "yuv420p"];
    lavfi(dir, "screen.mkv", "color=c=red:s=320x180:r=60:d=4", h264);
    lavfi(dir, "camera.mkv", "color=c=lime:s=384x216:r=30000/1001:d=4", h264);
    lavfi(dir, "mic.mkv", "sine=f=440:r=48000:d=4", [
      "-c:a",
      "aac",
      "-ac",
      "1",
    ]);

    commands = [];
    const program = Effect.gen(function* () {
      const passes = makeVideoExportPasses({
        ffmpegEncode: yield* FFmpegEncodeService,
        ffmpegCommands: yield* FFmpegCommandsService,
        effectFs: yield* FileSystem.FileSystem,
        videoEditorLogger: {
          log: (_videoId, event) =>
            Effect.sync(() => {
              if (event.type === "cli-output") commands.push(event.command);
            }),
        } as Parameters<typeof makeVideoExportPasses>[0]["videoEditorLogger"],
      });
      return yield* passes.exportVideoClips({
        videoId: "video-1",
        format: "landscape",
        clips: [...clips],
      });
    });
    const result = await Effect.runPromise(
      program.pipe(
        Effect.provide(
          Layer.mergeAll(
            FFmpegEncodeService.Default,
            FFmpegCommandsService.Default,
            NodeContext.layer,
            SidecarContextTest
          ).pipe(
            Layer.provide(
              Layer.setConfigProvider(
                ConfigProvider.fromMap(
                  new Map([
                    ["FINISHED_VIDEOS_DIRECTORY", path.join(dir, "out")],
                  ])
                )
              )
            )
          )
        )
      )
    );
    output = result.outputPath;
  }, 120_000);

  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("draws each Clip's scene segments in a graph of its own, mic offset and EQ applied", () => {
    const segments = commands.filter(
      (c) => c.startsWith("[export:concat]") && c.includes("-filter_complex")
    );
    expect(segments).toHaveLength(2);
    segments.forEach((command, i) => {
      const clip = clips[i]!;
      expect(command).toContain(
        sceneFilterGraph({
          segments: clip.composite!.segments,
          inputStartSeconds: clip.startTime,
          output: "composite",
        })
      );
      // The mic is read 150 ms earlier than the picture, with the highs down.
      expect(command).toContain(
        `-ss ${clip.startTime - 0.15} -t ${clip.duration} -i ${path.join(dir, "mic.mkv")}`
      );
      expect(command).toContain("highshelf=f=5000:g=-6.1");
    });
    expect(clips[0]!.composite!.segments.map((s) => s.scene)).toEqual([
      "Code",
      "Camera",
    ]);

    const join = commands.filter((c) => c.includes("-f concat"));
    expect(join).toHaveLength(1);
    expect(join[0]).toContain("-c:v copy");
  });

  it("writes CFR 60 H.264 yuv420p with BT.709 tags and AAC 48 kHz", () => {
    const { streams, format } = probe(output);
    const video = streams.find((s) => s.codec_type === "video")!;
    const audio = streams.find((s) => s.codec_type === "audio")!;
    expect(video).toMatchObject({
      codec_name: "h264",
      pix_fmt: "yuv420p",
      r_frame_rate: "60/1",
      color_space: "bt709",
      color_primaries: "bt709",
      color_transfer: "bt709",
    });
    expect(audio).toMatchObject({ codec_name: "aac", sample_rate: "48000" });
    expect(Number(format.duration)).toBeCloseTo(2.5, 1);
  });

  it("shows the screen in the Code scene and the camera in the Camera scene", () => {
    const near = (rgb: number[], expected: number[]) =>
      rgb.every((v, i) => Math.abs(v - expected[i]!) <= 40);
    // 0.5 s in: Code, the screen fills the frame centre.
    expect(near(pixel(output, 0.5, 960, 540), [255, 0, 0])).toBe(true);
    // 1.2 s in (session 1.7 s): Camera, the camera fills it.
    expect(near(pixel(output, 1.2, 960, 540), [0, 255, 0])).toBe(true);
  });
});
