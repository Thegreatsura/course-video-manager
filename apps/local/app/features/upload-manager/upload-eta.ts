import type { UploadEntry } from "./upload-entry";
import type { HistoryLookup } from "@/features/jobs/job-stage-history";
import type { UploadTiming } from "./upload-timing";
import {
  historyKey,
  isWaitStage,
  stageBand,
  stagePlan,
  stageUnits,
} from "./upload-eta-stages";

/**
 * A single job's time-to-finish, from two sources blended together:
 *
 * - **history** — how long this stage has taken before (`job-stage-history`),
 *   the only basis for a stage that streams no percentage or has not started;
 * - **live rate** — how fast the bar has moved over the last
 *   `SAMPLE_WINDOW_MS`, once there is enough of it to trust.
 *
 * Early in a stage the history speaks; as the live signal builds it takes
 * over. Parents, and Videos queued behind a pool, are scheduled in
 * `upload-eta-schedule`.
 */

export type UploadEta =
  | { kind: "none" }
  | { kind: "estimating" }
  /**
   * `job`: until the whole job finishes. `stage`: until the current stage
   * does — said when the stages after it have no history to go on.
   */
  | { kind: "remaining"; ms: number; scope: "job" | "stage" };

export interface EtaContext {
  timings: Record<string, UploadTiming>;
  history: HistoryLookup;
  now: number;
}

/** No live estimate before this much time *and* this much of the stage. */
export const MIN_SIGNAL_MS = 3_000;
export const MIN_SIGNAL_FRACTION = 0.02;
/** The live rate has fully taken over from history by this much of a stage. */
export const LIVE_TRUST_FRACTION = 0.25;

export const NO_ETA: UploadEta = { kind: "none" };
export const ESTIMATING: UploadEta = { kind: "estimating" };

/** What a stage of this job should take, by history; `null` with none. */
export const expectedStageMs = (
  upload: UploadEntry,
  stage: string,
  history: HistoryLookup
): number | null => {
  const stats = history(historyKey(upload, stage));
  if (!stats) return null;
  const units = stageUnits(upload, stage);
  return units && stats.msPerUnit ? stats.msPerUnit * units : stats.typicalMs;
};

/**
 * - a number: milliseconds left in the stage;
 * - `overdue`: every basis says it should be done by now — so it cannot say
 *   how much longer, and never counts down past zero;
 * - `gathering`: it streams a percentage, but not enough of it yet, and
 *   there is no history to fill in;
 * - `unknown`: nothing will ever say (no percentage, no history).
 */
export type StageRemaining = number | "overdue" | "gathering" | "unknown";

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

const settle = (ms: number): StageRemaining => (ms > 0 ? ms : "overdue");

/**
 * Milliseconds left of a measured span, from a prior expectation and the live
 * rate over `timing.samples`, blended by how much of the span the live rate
 * has seen. `prior` is `null` when there is none.
 */
export const blendedRemaining = (
  timing: UploadTiming,
  band: { start: number; width: number },
  prior: number | null,
  now: number
): StageRemaining => {
  const fraction = (progress: number) =>
    clamp01((progress - band.start) / band.width);
  const first = timing.samples[0]!;
  const last = timing.samples[timing.samples.length - 1]!;
  const done = fraction(last.progress);
  const seen = done - fraction(timing.stageStartProgress);
  const sinceLast = now - last.at;

  const span = last.at - first.at;
  const rate = span > 0 ? (done - fraction(first.progress)) / span : 0;
  const hasSignal =
    now - timing.stageStartedAt >= MIN_SIGNAL_MS &&
    seen >= MIN_SIGNAL_FRACTION &&
    rate > 0;
  const live = hasSignal ? (1 - done) / rate - sinceLast : null;

  if (live === null && prior === null) return "gathering";
  if (live === null) return settle(prior!);
  if (prior === null) return settle(live);
  const trust = clamp01(seen / LIVE_TRUST_FRACTION);
  return settle(trust * live + (1 - trust) * prior);
};

/** Time left in the stage the job is in now. */
export const currentStageRemaining = (
  upload: UploadEntry,
  timing: UploadTiming,
  { history, now }: Pick<EtaContext, "history" | "now">
): StageRemaining => {
  const stage = timing.stage;
  if (stage === null) return "unknown";
  const expected = expectedStageMs(upload, stage, history);
  const band = stageBand(upload, stage);
  if (!band || band.width <= 0) {
    if (expected === null) return "unknown";
    return settle(expected - (now - timing.stageStartedAt));
  }
  const last = timing.samples[timing.samples.length - 1]!;
  const done = clamp01((last.progress - band.start) / band.width);
  const prior =
    expected === null ? null : expected * (1 - done) - (now - last.at);
  return blendedRemaining(timing, band, prior, now);
};

/**
 * History's total for the stages still ahead of the current one. `null` if
 * any of them has no history — or is a parent's `work`, which only its
 * children can estimate.
 */
export const stagesAheadMs = (
  upload: UploadEntry,
  timing: UploadTiming,
  history: HistoryLookup
): number | null => {
  const plan = stagePlan(upload, timing.needsExport);
  const index = timing.stage === null ? -1 : plan.indexOf(timing.stage);
  let total = 0;
  for (const stage of plan.slice(index + 1)) {
    if (stage === "work") return null;
    if (isWaitStage(stage)) continue;
    const expected = expectedStageMs(upload, stage, history);
    if (expected === null) return null;
    total += expected;
  }
  return total;
};

/** A job estimated on its own: its current stage plus history for the rest. */
export const jobEta = (
  upload: UploadEntry,
  timing: UploadTiming | undefined,
  context: EtaContext
): UploadEta => {
  if (!timing || upload.status !== "uploading" || timing.stage === null) {
    return NO_ETA;
  }
  const current = currentStageRemaining(upload, timing, context);
  const waiting = isWaitStage(timing.stage);
  if (current === "overdue" || current === "gathering") return ESTIMATING;
  if (current === "unknown" && !waiting) return NO_ETA;
  const currentMs = typeof current === "number" ? current : 0;

  const ahead = stagesAheadMs(upload, timing, context.history);
  if (ahead === null) {
    return waiting
      ? NO_ETA
      : { kind: "remaining", ms: currentMs, scope: "stage" };
  }
  const total = currentMs + ahead;
  return total > 0
    ? { kind: "remaining", ms: total, scope: "job" }
    : ESTIMATING;
};

/** "~45s", "~3m", "~1h 5m" — rounded, because the estimate is. */
export const formatRemaining = (ms: number): string => {
  const seconds = Math.max(0, ms) / 1000;
  if (seconds < 10) return "<10s";
  const fives = Math.ceil(seconds / 5) * 5;
  if (fives < 60) return `~${fives}s`;
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `~${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `~${hours}h` : `~${hours}h ${rest}m`;
};

/** The text beside a row's percent, or `null` for nothing at all. */
export const etaLabel = (eta: UploadEta): string | null => {
  switch (eta.kind) {
    case "none":
      return null;
    case "estimating":
      return "estimating…";
    case "remaining":
      return `${formatRemaining(eta.ms)} left${eta.scope === "stage" ? " in stage" : ""}`;
  }
};
