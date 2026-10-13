import { describe, expect, it } from "vitest";
import {
  clapStepMicOffsetMs,
  frameAtMs,
  frameMs,
  loudestMs,
  startingVideoFrame,
  waveformPeaks,
} from "@/packages/clap-step";

describe("the clap step's maths", () => {
  it("steps the picture in 29.97 fps frames", () => {
    expect(frameMs(30)).toBeCloseTo(1001, 6);
    expect(frameAtMs(1001)).toBe(30);
    expect(frameAtMs(1001 + 16)).toBe(30);
    expect(frameAtMs(1001 + 17)).toBe(31);
  });

  it("says the Mic Offset as video time less sound time, in whole ms (how much later the mic plays)", () => {
    // The hands meet on frame 30 (1001 ms); the mic heard them at 900 ms.
    expect(clapStepMicOffsetMs(900, 30)).toBe(101);
    expect(clapStepMicOffsetMs(1100, 30)).toBe(-99);
  });

  it("starts the video slider at the sound's time shifted by the current Mic Offset", () => {
    expect(startingVideoFrame(851, 150)).toBe(30);
    expect(startingVideoFrame(1093, -92)).toBe(30);
  });

  it("finds the loudest sample, either sign, in ms", () => {
    const samples = new Float32Array(48_000);
    samples[4_800] = 0.5;
    samples[24_000] = -0.9;
    expect(loudestMs(samples, 48_000)).toBe(500);
  });

  it("draws each 1 ms's peak", () => {
    const samples = new Float32Array(48 * 3);
    samples[50] = -0.25;
    samples[100] = 0.75;
    expect(waveformPeaks(samples, 48_000)).toEqual([0, 0.25, 0.75]);
  });
});
