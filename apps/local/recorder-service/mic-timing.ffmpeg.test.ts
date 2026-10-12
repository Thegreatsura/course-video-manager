import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { findStartUpGap } from "../app/packages/clap-detection";
import { micOnClock } from "./capture-args";

/**
 * The mic's timing (`micOnClock`) in the real ffmpeg, over a synthetic mic
 * (no device) stamped the way -use_wallclock_as_timestamps stamps
 * DirectShow's: each 20 ms buffer when ffmpeg reads it, a millisecond or two
 * after its last sample, jittered. Like the real one it starts with a burst
 * (audio queued while the camera opened, read at once) and can stall: ffmpeg
 * stops reading for a while, then reads the backlog all stamped "now". A
 * clap at 3 s of mic audio must land at the same file time whatever the
 * stall. Skipped where there is no ffmpeg.
 */
const hasFfmpeg = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

/** Windows wall time of T0, in seconds; the mic starts capturing 0.2 s later. */
const T0 = 1000;
const CAPTURE_START = 0.2;
/** Audio before this (capture time) waits for the camera to open. */
const BURST_END = 0.8;
/** The stall starts here (capture time), about where real ones fall. */
const STALL_AT = 1.45;
const CLAP_AT = 3;
const BUFFER_SAMPLES = 960;

/**
 * Arrival stamp of the buffer of samples [N, N + NB_SAMPLES): its last
 * sample's capture time plus 1-3 ms of read latency, or, for a buffer held
 * back by the burst or the stall, the moment the hold ends, the backlog read
 * a thousand times faster than real time.
 */
const arrival = (stallSeconds: number) => {
  const end = "(N+NB_SAMPLES)/SR";
  const latency = "0.001+0.001*(1+sin(N*12.9898))";
  const stallEnd = STALL_AT + stallSeconds;
  const heldUntil = `max(lt(${end},${BURST_END})*${BURST_END},between(${end},${STALL_AT},${stallEnd})*${stallEnd})`;
  const stamp = `max(${end}+${latency},${heldUntil}+0.001+N/SR/1000)`;
  return `(${T0 + CAPTURE_START}+${stamp})/TB`;
};

describe.skipIf(!hasFfmpeg)("the mic's timing in ffmpeg", () => {
  /**
   * File time of the clap in the mic file, through `micOnClock`: where the
   * first silence (everything below -10 dB) ends, as silencedetect reads it
   * from the mic's own timestamps.
   */
  const clapFileTime = (stallMs: number) => {
    const signal = `0.01*sin(2*PI*440*t)+0.9*between(t,${CLAP_AT},${CLAP_AT + 0.01})`;
    const { stderr } = spawnSync(
      "ffmpeg",
      [
        "-hide_banner",
        "-nostats",
        "-copyts",
        "-f",
        "lavfi",
        "-i",
        `aevalsrc=exprs='${signal}|${signal}':s=48000:n=${BUFFER_SAMPLES}:d=5,asetpts='${arrival(stallMs / 1000)}'`,
        "-filter_complex",
        `${micOnClock(T0.toFixed(3), "0:a")},silencedetect=n=-10dB:d=0.5[mic]`,
        "-map",
        "[mic]",
        "-f",
        "null",
        "-",
      ],
      { encoding: "utf8" }
    );
    const end = /silence_end: ([\d.]+)/.exec(stderr);
    expect(end, stderr).not.toBeNull();
    return Number(end![1]);
  };

  it("places a clap the same with and without a start-up stall", () => {
    const steady = clapFileTime(0);
    // Unchanged from before sample-count timing when nothing stalls: capture
    // time, plus one 20 ms buffer and the quickest read latency.
    expect(steady).toBeCloseTo(CAPTURE_START + CLAP_AT + 0.021, 2);
    for (const stallMs of [100, 150, 200, 250, 300, 350, 400]) {
      const shiftMs = (clapFileTime(stallMs) - steady) * 1000;
      expect({ stallMs, shiftMs: Math.abs(shiftMs) < 1 ? 0 : shiftMs }).toEqual(
        { stallMs, shiftMs: 0 }
      );
    }
  });

  it("leaves no start-up gap for the AV Calibration's gap check to fail on", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "mic-timing-"));
    try {
      for (const stallMs of [0, 150, 400]) {
        // mic.wav as the calibration run writes it, read back as the clap
        // detection reads it.
        const wav = path.join(dir, `${stallMs}.wav`);
        execFileSync("ffmpeg", [
          "-hide_banner",
          "-v",
          "error",
          "-y",
          "-copyts",
          "-f",
          "lavfi",
          "-i",
          `aevalsrc=exprs='0.1*sin(2*PI*440*t)|0.1*sin(2*PI*440*t)':s=48000:n=${BUFFER_SAMPLES}:d=5,asetpts='${arrival(stallMs / 1000)}'`,
          "-filter_complex",
          `${micOnClock(T0.toFixed(3), "0:a")}[mic]`,
          "-map",
          "[mic]",
          "-c:a",
          "pcm_s16le",
          wav,
        ]);
        const pcm = execFileSync(
          "ffmpeg",
          ["-v", "error", "-i", wav, "-ac", "1", "-f", "f32le", "-"],
          { maxBuffer: 1 << 26 }
        );
        const samples = new Float32Array(
          pcm.buffer,
          pcm.byteOffset,
          pcm.byteLength / 4
        );
        expect({ stallMs, gap: findStartUpGap(samples, 48000) }).toEqual({
          stallMs,
          gap: null,
        });
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
