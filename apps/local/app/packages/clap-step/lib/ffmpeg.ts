import { Command } from "@effect/platform";
import { Chunk, Data, Effect, Stream } from "effect";
import { CAMERA_FPS } from "@/av-calibration-constants";
import {
  CLAP_PREVIEW_ENCODE_ARGS,
  GPU_DECODE_ARGS,
  classifyGpuFailure,
  cpuFallbackArgs,
} from "@/services/ffmpeg-error";
import { PLAY_LOOP_SECONDS } from "./clap-step";

export class ClapStepFfmpegError extends Data.TaggedError(
  "ClapStepFfmpegError"
)<{ readonly message: string }> {}

/** Two threads at most: the clap step is a page Matt waits on, not an encode. */
const THREADS = "2";

/** Runs ffmpeg once: its exit code, stdout and stderr. */
const runOnce = (args: readonly string[]) =>
  Effect.scoped(
    Effect.gen(function* () {
      const process = yield* Command.start(
        Command.make(
          "ffmpeg",
          "-hide_banner",
          "-nostats",
          "-v",
          "error",
          ...args
        )
      );
      const [stdout, stderr] = yield* Effect.all(
        [
          process.stdout.pipe(Stream.runCollect, Effect.map(Chunk.toArray)),
          process.stderr.pipe(Stream.decodeText(), Stream.mkString),
        ],
        { concurrency: 2 }
      );
      const code = yield* process.exitCode;
      return { code, stdout, stderr };
    })
  );

/**
 * Runs ffmpeg, answering everything it wrote to stdout. A run that asked the
 * GPU for something (NVDEC, NVENC) and found none is run once more on the
 * CPU (`cpuFallbackArgs`). One that found the GPU but no free NVENC session
 * fails at once, saying so: the page is waited on, so it does not sit through
 * `runFfmpegWithProgress`'s minutes of retries, and a busy GPU is never moved
 * to the CPU (#2141). Clicking again retries.
 */
const run = (args: string[]) =>
  Effect.gen(function* () {
    let result = yield* runOnce(args);
    if (result.code !== 0) {
      const fallbackArgs = cpuFallbackArgs(args, result.stderr);
      if (fallbackArgs) result = yield* runOnce(fallbackArgs);
    }
    const { code, stdout, stderr } = result;
    if (code !== 0 && classifyGpuFailure(stderr) === "nvenc-sessions-exhausted")
      return yield* new ClapStepFfmpegError({
        message:
          "NVENC has no free encoder session (the GPU is busy — OBS, the recorder or an export); try again in a moment",
      });
    if (code !== 0)
      return yield* new ClapStepFfmpegError({
        message: `ffmpeg exited ${code}: ${stderr.trim().split(/\r?\n/).slice(-2).join(" ")}`,
      });
    const out = new Uint8Array(stdout.reduce((n, c) => n + c.length, 0));
    let at = 0;
    for (const c of stdout) {
      out.set(c, at);
      at += c.length;
    }
    return out;
  }).pipe(
    Effect.catchTag("SystemError", "BadArgument", (e) =>
      Effect.fail(new ClapStepFfmpegError({ message: e.message }))
    )
  );

const seconds = (ms: number) => (Math.max(0, ms) / 1000).toFixed(4);

/**
 * The mic file from `fromMs` to `toMs` (ms of the file), mono, as float
 * samples at `sampleRate`.
 */
export const readMicSamples = Effect.fn("readMicSamples")(function* (o: {
  micFile: string;
  fromMs: number;
  toMs: number;
  sampleRate: number;
}) {
  const bytes = yield* run([
    "-i",
    o.micFile,
    "-af",
    `atrim=start=${seconds(o.fromMs)}:end=${seconds(o.toMs)}`,
    "-ac",
    "1",
    "-ar",
    String(o.sampleRate),
    "-f",
    "f32le",
    "-",
  ]);
  return new Float32Array(
    bytes.buffer,
    bytes.byteOffset,
    Math.floor(bytes.byteLength / 4)
  );
});

/**
 * Camera frame `frame` as a JPEG. Seeks to half a frame before it, so the
 * first frame out is exactly it however its time was rounded in the file.
 */
export const cameraFrameJpeg = Effect.fn("cameraFrameJpeg")(function* (o: {
  cameraFile: string;
  frame: number;
}) {
  return yield* run([
    "-threads",
    THREADS,
    ...GPU_DECODE_ARGS,
    "-ss",
    seconds(((o.frame - 0.5) * 1000) / CAMERA_FPS),
    "-i",
    o.cameraFile,
    "-frames:v",
    "1",
    "-an",
    "-c:v",
    "mjpeg",
    "-q:v",
    "3",
    "-f",
    "image2pipe",
    "-",
  ]);
});

/**
 * Play's clip: `PLAY_LOOP_SECONDS` of the camera centred on `videoMs`, with
 * the mic played `micOffsetMs` later (as the export plays it: the mic read
 * from the camera's time less the offset), as a fragmented MP4 the page
 * loops. The camera decodes on NVDEC and the clip encodes on NVENC, small and
 * fast; with no usable GPU, on the CPU as libx264 `ultrafast`.
 */
export const clapPreviewMp4 = Effect.fn("clapPreviewMp4")(function* (o: {
  cameraFile: string;
  micFile: string;
  videoMs: number;
  micOffsetMs: number;
}) {
  const half = (PLAY_LOOP_SECONDS * 1000) / 2;
  // Never before either file starts.
  const videoStartMs = Math.max(o.videoMs - half, o.micOffsetMs, 0);
  const micStartMs = videoStartMs - o.micOffsetMs;
  const length = String(PLAY_LOOP_SECONDS);
  return yield* run([
    ...GPU_DECODE_ARGS,
    "-ss",
    seconds(videoStartMs),
    "-t",
    length,
    "-i",
    o.cameraFile,
    "-ss",
    seconds(micStartMs),
    "-t",
    length,
    "-i",
    o.micFile,
    "-map",
    "0:v:0",
    "-map",
    "1:a:0",
    ...CLAP_PREVIEW_ENCODE_ARGS,
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-shortest",
    "-movflags",
    "frag_keyframe+empty_moov+default_base_moof",
    "-f",
    "mp4",
    "-",
  ]);
});
