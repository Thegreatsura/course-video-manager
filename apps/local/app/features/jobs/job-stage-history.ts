import type { JobStageHistoryMessage } from "./job-wire";
import { foldJobEvents } from "./jobs-timing";

/**
 * How long each stage of each kind of Job has taken, keyed
 * `<job type>:<stage>` (`historyKey`): the ETA's prior, what it says before
 * the live rate has enough signal, and its only basis for stages that have
 * not started or never stream a percentage.
 *
 * It is read from `job_event` (`GET /api/jobs/stage-history`): the newest
 * succeeded Jobs of each kind, folded here exactly as the live stream is
 * (`foldJobEvents`), so the keys and durations are the ones the live rows
 * use. Any tab, in any browser, starts with it; the jobs reducer loads it
 * with each snapshot and again whenever a Job succeeds.
 */

export interface StageRecord {
  durationMs: number;
  /** The stage's size where the client knows it — bytes, for an upload. */
  units: number | null;
}

export interface StageStats {
  /** The median duration: robust to the one run that hit a cold cache. */
  typicalMs: number;
  /** The median time per unit, when any record carried a size. */
  msPerUnit: number | null;
  count: number;
}

export type HistoryLookup = (key: string) => StageStats | null;

/** Every stage's records, oldest first. */
export type HistoryData = Record<string, StageRecord[]>;

/** Recent runs only, so a faster machine or uplink shows up within a few runs. */
export const MAX_RECORDS_PER_STAGE = 20;

const median = (values: number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

const isValidRecord = (record: StageRecord): boolean =>
  Number.isFinite(record.durationMs) &&
  record.durationMs > 0 &&
  (record.units === null || record.units > 0);

export const statsFrom = (records: StageRecord[]): StageStats | null => {
  const typicalMs = median(records.map((r) => r.durationMs));
  if (typicalMs === null) return null;
  return {
    typicalMs,
    msPerUnit: median(
      records.flatMap((r) => (r.units ? [r.durationMs / r.units] : []))
    ),
    count: records.length,
  };
};

/**
 * Every stage the history's Jobs finished, oldest Job first, the newest
 * `MAX_RECORDS_PER_STAGE` per stage. A duration that cannot be real is
 * dropped.
 */
export const stageHistoryFrom = (
  message: JobStageHistoryMessage
): HistoryData => {
  const data: HistoryData = {};
  for (const { job, events } of message.jobs) {
    for (const stage of foldJobEvents(job, events).completed) {
      const record = { durationMs: stage.durationMs, units: stage.units };
      if (!isValidRecord(record)) continue;
      (data[stage.key] ??= []).push(record);
    }
  }
  for (const key of Object.keys(data)) {
    data[key] = data[key]!.slice(-MAX_RECORDS_PER_STAGE);
  }
  return data;
};

/** Look stages up in `data`, each one's stats worked out once. */
export const historyLookupOf = (data: HistoryData): HistoryLookup => {
  const cache = new Map<string, StageStats | null>();
  return (key) => {
    if (!cache.has(key)) cache.set(key, statsFrom(data[key] ?? []));
    return cache.get(key)!;
  };
};
