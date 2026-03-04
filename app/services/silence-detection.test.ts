import { describe, it, expect } from "vitest";
import { Effect } from "effect";
import { NodeContext } from "@effect/platform-node";
import { findSilenceInVideo } from "./silence-detection";
import type { FFmpegCommandsService } from "./ffmpeg-commands";

/**
 * Builds a mock FFmpegCommandsService that returns predetermined output.
 * Only `getFPS` and `detectSilence` are used by `findSilenceInVideo`.
 */
function mockFFmpeg(opts: {
  fps: number;
  silenceOutput: string;
}): FFmpegCommandsService {
  return {
    getFPS: () => Effect.succeed(opts.fps),
    detectSilence: () => Effect.succeed(opts.silenceOutput),
  } as unknown as FFmpegCommandsService;
}

/**
 * Silence detect output with two silence periods → one speaking clip between them.
 * Speaking segment: silence ends at 2.0s, next silence starts at 5.0s → clip 2.0–5.0
 */
const SILENCE_OUTPUT_TWO_PERIODS = [
  "[silencedetect @ 0x1] silence_start: 0",
  "[silencedetect @ 0x1] silence_end: 2.0 | silence_duration: 2.0",
  "[silencedetect @ 0x1] silence_start: 5.0",
  "[silencedetect @ 0x1] silence_end: 6.0 | silence_duration: 1.0",
].join("\n");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const run = <A>(effect: Effect.Effect<A, any, any>): Promise<A> =>
  Effect.runPromise(
    effect.pipe(Effect.provide(NodeContext.layer)) as Effect.Effect<A>
  );

describe("findSilenceInVideo", () => {
  it("returns clips without offset when startTime is not provided", async () => {
    const ffmpeg = mockFFmpeg({
      fps: 30,
      silenceOutput: SILENCE_OUTPUT_TWO_PERIODS,
    });

    const result = await run(findSilenceInVideo(ffmpeg, "/test/video.mkv"));

    expect(result.clips).toHaveLength(1);
    const clip = result.clips[0]!;
    // At 30fps: startFrame = round(2.0 * 30) - 0 = 60, startTime = 60/30 = 2.0
    // endFrame = round(5.0 * 30) + round(0.08 * 30) = 150 + 2 = 152, endTime = 152/30 ≈ 5.07
    expect(clip.startTime).toBeCloseTo(2.0, 1);
    expect(clip.endTime).toBeCloseTo(5.07, 1);
  });

  it("adjusts clip timestamps by startTime offset", async () => {
    const ffmpeg = mockFFmpeg({
      fps: 30,
      silenceOutput: SILENCE_OUTPUT_TWO_PERIODS,
    });

    const startTimeOffset = 99;
    const result = await run(
      findSilenceInVideo(ffmpeg, "/test/video.mkv", {
        startTime: startTimeOffset,
      })
    );

    expect(result.clips).toHaveLength(1);
    const clip = result.clips[0]!;
    // Same as above but offset by 99s
    expect(clip.startTime).toBeCloseTo(2.0 + startTimeOffset, 1);
    expect(clip.endTime).toBeCloseTo(5.07 + startTimeOffset, 0);
  });

  it("does not adjust timestamps when startTime is 0", async () => {
    const ffmpeg = mockFFmpeg({
      fps: 30,
      silenceOutput: SILENCE_OUTPUT_TWO_PERIODS,
    });

    const result = await run(
      findSilenceInVideo(ffmpeg, "/test/video.mkv", { startTime: 0 })
    );

    expect(result.clips).toHaveLength(1);
    const clip = result.clips[0]!;
    expect(clip.startTime).toBeCloseTo(2.0, 1);
    expect(clip.endTime).toBeCloseTo(5.07, 1);
  });
});
