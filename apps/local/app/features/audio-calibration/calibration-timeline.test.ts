import { describe, expect, it } from "vitest";
import { SILENCE_LENGTH_SHORT_SECONDS } from "@/silence-detection-constants";
import { buildCalibrationTimeline } from "./calibration-timeline";

/**
 * A two-line script, timed as a run stores it: get ready 0–1 s, silence
 * 1–3 s, read 3–5 s, pause 5–7.5 s, read 7.5–9.5 s, pause 9.5–12 s, with a
 * 0.5 s reaction margin (the measurement windows start a margin late).
 */
const traceFile = (trace: { seconds: number; peakDb: number }[] | null) => ({
  schedule: [
    { kind: "countdown" as const, startSeconds: 0, endSeconds: 1 },
    { kind: "silence" as const, startSeconds: 1, endSeconds: 3 },
    { kind: "read" as const, line: 1, startSeconds: 3, endSeconds: 5 },
    { kind: "pause" as const, line: 1, startSeconds: 5, endSeconds: 7.5 },
    { kind: "read" as const, line: 2, startSeconds: 7.5, endSeconds: 9.5 },
    { kind: "pause" as const, line: 2, startSeconds: 9.5, endSeconds: 12 },
  ],
  measurementWindows: {
    silence: { startSeconds: 1.5, endSeconds: 2.5 },
    speech: [
      { startSeconds: 3.5, endSeconds: 5.5 },
      { startSeconds: 8, endSeconds: 10 },
    ],
  },
  trace,
});

/** A canned trace: 0.1 s blocks from `from` to `to`, loud where `loud` says. */
const cannedTrace = (
  from: number,
  to: number,
  loud: (seconds: number) => boolean
) =>
  Array.from({ length: Math.round((to - from) * 10) }, (_, i) => {
    const seconds = Math.round((from + i * 0.1) * 10) / 10;
    return { seconds, peakDb: loud(seconds) ? -20 : -60 };
  });

/** Canned silencedetect stderr for the run's mic file (12.4 s long). */
const SILENCEDETECT = `Input #0, wav, from 'mic.wav':
  Duration: 00:00:12.40, bitrate: 1536 kb/s
[silencedetect @ 0x55d] silence_start: -0.000166667
[silencedetect @ 0x55d] silence_end: 3.62 | silence_duration: 3.62
[silencedetect @ 0x55d] silence_start: 5.31
[silencedetect @ 0x55d] silence_end: 7.9 | silence_duration: 2.59
[silencedetect @ 0x55d] silence_start: 8.6
[silencedetect @ 0x55d] silence_end: 9.2 | silence_duration: 0.6
[silencedetect @ 0x55d] silence_start: 9.7
size=N/A time=00:00:12.40 bitrate=N/A speed= 900x`;

describe("buildCalibrationTimeline", () => {
  it("lays the prompts, the browser's trace and silencedetect's output on one axis, cut with the calibration's threshold and the short Silence Length", () => {
    // Loud while reading, a 0.4 s dip mid-line 1 (too short to cut), and a
    // block at -37 dB in the first pause, under a -36 dB threshold.
    const timeline = buildCalibrationTimeline({
      calibrationId: "cal-1",
      thresholdDb: -36,
      traceFile: traceFile(
        cannedTrace(
          0.3,
          12.3,
          (s) =>
            (s >= 3.6 && s < 3.9) ||
            (s >= 4.3 && s < 5.2) ||
            (s >= 7.8 && s < 9.6)
        )
      ),
      silencedetectOutput: SILENCEDETECT,
    });

    expect(timeline.rule).toEqual({
      thresholdDb: -36,
      minSilenceSeconds: SILENCE_LENGTH_SHORT_SECONDS,
    });
    expect(timeline.reactionMarginSeconds).toBeCloseTo(0.5);
    expect(timeline.prompts.map((p) => p.kind)).toEqual([
      "countdown",
      "silence",
      "read",
      "pause",
      "read",
      "pause",
    ]);
    expect(timeline.endSeconds).toBeCloseTo(12.4);

    const rounded = (spans: typeof timeline.ffmpeg | null) =>
      spans?.map((s) => [
        s.kind,
        Math.round(s.startSeconds * 100) / 100,
        Math.round(s.endSeconds * 100) / 100,
      ]);

    // The 0.4 s dip in line 1 is shorter than 0.8 s, so it stays speech.
    expect(rounded(timeline.browser)).toEqual([
      ["silence", 0.3, 3.6],
      ["speech", 3.6, 5.2],
      ["silence", 5.2, 7.8],
      ["speech", 7.8, 9.6],
      ["silence", 9.6, 12.3],
    ]);
    // A silence shorter than the rule from silencedetect is drawn as it came;
    // the last, still open, runs to the file's end.
    expect(rounded(timeline.ffmpeg)).toEqual([
      ["silence", 0, 3.62],
      ["speech", 3.62, 5.31],
      ["silence", 5.31, 7.9],
      ["speech", 7.9, 8.6],
      ["silence", 8.6, 9.2],
      ["speech", 9.2, 9.7],
      ["silence", 9.7, 12.4],
    ]);
  });

  it("has no browser row when the run had no browser input", () => {
    const timeline = buildCalibrationTimeline({
      calibrationId: "cal-2",
      thresholdDb: -38,
      traceFile: traceFile(null),
      silencedetectOutput: SILENCEDETECT,
    });
    expect(timeline.browser).toBeNull();
    expect(timeline.ffmpeg.length).toBeGreaterThan(0);
  });
});
