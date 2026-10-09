import { ConfigProvider, Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_CPU_PERMITS,
  DEFAULT_ENCODE_PERMITS,
  FfmpegPermitsService,
} from "./ffmpeg-permits";

const readPermits = (env: Record<string, string>) =>
  Effect.runPromise(
    FfmpegPermitsService.pipe(
      Effect.map(({ encodePermits, cpuPermits }) => ({
        encodePermits,
        cpuPermits,
      })),
      Effect.provide(
        FfmpegPermitsService.Default.pipe(
          Layer.provide(
            Layer.setConfigProvider(
              ConfigProvider.fromMap(new Map(Object.entries(env)))
            )
          )
        )
      )
    )
  );

describe("FfmpegPermitsService", () => {
  it("keeps 2 encode slots and 12 CPU permits when nothing is set", async () => {
    expect(await readPermits({})).toEqual({
      encodePermits: DEFAULT_ENCODE_PERMITS,
      cpuPermits: DEFAULT_CPU_PERMITS,
    });
  });

  it("lowers both to what a verify clone run sets", async () => {
    expect(
      await readPermits({ FFMPEG_ENCODE_PERMITS: "1", FFMPEG_CPU_PERMITS: "1" })
    ).toEqual({ encodePermits: 1, cpuPermits: 1 });
  });

  it("refuses zero rather than deadlocking every encode", async () => {
    await expect(readPermits({ FFMPEG_ENCODE_PERMITS: "0" })).rejects.toThrow(
      /FFMPEG_ENCODE_PERMITS must be at least 1/
    );
  });
});
