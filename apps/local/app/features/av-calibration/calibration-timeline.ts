import type { ScriptStep, TimeWindow } from "@/av-calibration-constants";
import {
  SILENCE_LENGTH_SHORT_SECONDS,
  type SilenceRule,
} from "@/silence-detection-constants";
import type { BrowserTracePoint } from "./calibration-wire";

/**
 * AN AV CALIBRATION'S REVIEW TIMELINE (#2081): three rows on one time
 * axis, the seconds of the calibration's mic file (the recorder service's
 * clock), for Matt to judge by eye whether the detectors heard his speech and
 * his pauses where the prompts put them. Review only: nothing here decides
 * pass or fail.
 *
 * 1. The prompts: the script's schedule, with the reaction margin after each
 *    prompt's start.
 * 2. The browser detector: the browser's level trace, one peak per block.
 * 3. The FFmpeg detector: silencedetect run on the calibration's mic file.
 *
 * Both detector rows cut with the same rule: this calibration's threshold and
 * the short Silence Length, so they show how recording would cut.
 */

/** A stretch of one detector row: what the detector heard, from when to when. */
export type TimelineSpan = {
  kind: "speech" | "silence";
  startSeconds: number;
  endSeconds: number;
};

export type CalibrationTimeline = {
  calibrationId: string;
  /** What both detector rows cut with. */
  rule: SilenceRule;
  /** The axis' end, in seconds of the mic file; it starts at 0. */
  endSeconds: number;
  prompts: readonly ScriptStep[];
  /** How late Matt may react to each prompt, drawn after its start. */
  reactionMarginSeconds: number;
  /** Null when the run had no browser input, so no trace. */
  browser: TimelineSpan[] | null;
  ffmpeg: TimelineSpan[];
};

/** The rule a calibration's detector rows cut with: its threshold, the short Silence Length. */
export const calibrationDetectorRule = (thresholdDb: number): SilenceRule => ({
  thresholdDb,
  minSilenceSeconds: SILENCE_LENGTH_SHORT_SECONDS,
});

type Silence = { startSeconds: number; endSeconds: number };

/** Silences over `[from, to]`, the gaps between them speech. */
const toSpans = (
  silences: readonly Silence[],
  from: number,
  to: number
): TimelineSpan[] => {
  const spans: TimelineSpan[] = [];
  let at = from;
  for (const s of silences) {
    const start = Math.max(s.startSeconds, at);
    const end = Math.min(s.endSeconds, to);
    if (end <= start) continue;
    if (start > at)
      spans.push({ kind: "speech", startSeconds: at, endSeconds: start });
    spans.push({ kind: "silence", startSeconds: start, endSeconds: end });
    at = end;
  }
  if (at < to) spans.push({ kind: "speech", startSeconds: at, endSeconds: to });
  return spans;
};

/**
 * The browser row: a block is silent when its peak is under the threshold
 * (every sample in it is, as `silence-scan.ts` judges each one); a run of
 * silent blocks lasting the Silence Length is a silence, from its first
 * block's start to the next loud block's start. Covers only the heard span.
 */
export const browserTraceSpans = (
  trace: readonly BrowserTracePoint[],
  rule: SilenceRule
): TimelineSpan[] => {
  const points = [...trace].sort((a, b) => a.seconds - b.seconds);
  if (points.length === 0) return [];
  const blockSeconds =
    points.length > 1 ? points[1]!.seconds - points[0]!.seconds : 0;
  const endOf = (i: number) =>
    i + 1 < points.length
      ? points[i + 1]!.seconds
      : points[i]!.seconds + blockSeconds;
  const silences: Silence[] = [];
  let runStart: number | null = null;
  const close = (endSeconds: number) => {
    if (
      runStart !== null &&
      endSeconds - runStart >= rule.minSilenceSeconds - 1e-9
    )
      silences.push({ startSeconds: runStart, endSeconds });
    runStart = null;
  };
  for (const p of points) {
    if (p.peakDb < rule.thresholdDb) runStart ??= p.seconds;
    else close(p.seconds);
  }
  const heardTo = endOf(points.length - 1);
  close(heardTo);
  return toSpans(silences, points[0]!.seconds, heardTo);
};

const NUMBER = String.raw`(-?[\d.]+)`;
const DURATION = /Duration:\s*(\d+):(\d+):([\d.]+)/;

/** The file's length from ffmpeg's input summary, in seconds. */
const durationOf = (output: string): number | undefined => {
  const m = output.match(DURATION);
  return m ? +m[1]! * 3600 + +m[2]! * 60 + +m[3]! : undefined;
};

/**
 * The FFmpeg row: silencedetect's silences in its output, over the whole
 * file. A silence still open at the end runs to the file's end.
 */
export const silencedetectSpans = (
  output: string,
  endSeconds: number
): TimelineSpan[] => {
  const silences: Silence[] = [];
  let open: number | null = null;
  for (const line of output.split(/\r?\n/)) {
    if (!line.includes("[silencedetect @")) continue;
    const start = line.match(new RegExp(`silence_start:\\s*${NUMBER}`));
    const end = line.match(new RegExp(`silence_end:\\s*${NUMBER}`));
    if (start) open = Math.max(0, Number(start[1]));
    if (end && open !== null) {
      silences.push({ startSeconds: open, endSeconds: Number(end[1]) });
      open = null;
    }
  }
  if (open !== null) silences.push({ startSeconds: open, endSeconds });
  return toSpans(silences, 0, endSeconds);
};

/** What is kept beside a calibration's mic file (`browser-trace.json`). */
export type CalibrationTraceFile = {
  schedule: readonly ScriptStep[];
  measurementWindows: { silence: TimeWindow; speech: readonly TimeWindow[] };
  trace: readonly BrowserTracePoint[] | null;
};

/**
 * The timeline of a stored calibration, from its threshold, the trace file
 * kept beside its mic file, and silencedetect's output on that file (run with
 * `calibrationDetectorRule`). The prompts and their margin are the ones the
 * run followed, as stored, not today's script.
 */
export const buildCalibrationTimeline = (o: {
  calibrationId: string;
  thresholdDb: number;
  traceFile: CalibrationTraceFile;
  silencedetectOutput: string;
}): CalibrationTimeline => {
  const rule = calibrationDetectorRule(o.thresholdDb);
  const { schedule, measurementWindows, trace } = o.traceFile;
  const silence = schedule.find((s) => s.kind === "silence");
  const reactionMarginSeconds = silence
    ? measurementWindows.silence.startSeconds - silence.startSeconds
    : 0;
  const scriptEnd = schedule.at(-1)?.endSeconds ?? 0;
  const fileEnd = durationOf(o.silencedetectOutput) ?? scriptEnd;
  const browser = trace ? browserTraceSpans(trace, rule) : null;
  const endSeconds = Math.max(
    fileEnd,
    scriptEnd,
    browser?.at(-1)?.endSeconds ?? 0
  );
  return {
    calibrationId: o.calibrationId,
    rule,
    endSeconds,
    prompts: schedule,
    reactionMarginSeconds,
    browser,
    ffmpeg: silencedetectSpans(o.silencedetectOutput, fileEnd),
  };
};
