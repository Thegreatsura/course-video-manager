/**
 * How long each stage of each job type has actually taken on this machine,
 * kept in localStorage and keyed `<job type>:<stage>` (see `historyKey`). It
 * is the ETA's prior: what it says before the live rate has enough signal,
 * and its only basis for stages that have not started or never stream a
 * percentage.
 *
 * Deliberately local rather than in the database: these are timings of this
 * machine's GPU and uplink, and losing them costs one run of "estimating…".
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

export interface UploadHistoryStore {
  lookup: HistoryLookup;
  record: (key: string, record: StageRecord) => void;
}

export type HistoryData = Record<string, StageRecord[]>;

/** Recent runs only, so a faster machine or uplink shows up within a few runs. */
export const MAX_RECORDS_PER_STAGE = 20;
export const HISTORY_STORAGE_KEY = "cvm.upload-eta.stage-history.v1";

const median = (values: number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

const isValidRecord = (record: unknown): record is StageRecord => {
  if (typeof record !== "object" || record === null) return false;
  const { durationMs, units } = record as Record<string, unknown>;
  return (
    typeof durationMs === "number" &&
    Number.isFinite(durationMs) &&
    durationMs > 0 &&
    (units === null || (typeof units === "number" && units > 0))
  );
};

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

/** Whatever was stored, minus anything that is not a usable record. */
export const parseHistory = (raw: string | null): HistoryData => {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    const data: HistoryData = {};
    for (const [key, records] of Object.entries(parsed)) {
      if (!Array.isArray(records)) continue;
      const valid = records.filter(isValidRecord);
      if (valid.length > 0) data[key] = valid.slice(-MAX_RECORDS_PER_STAGE);
    }
    return data;
  } catch {
    return {};
  }
};

export const createHistoryStore = (
  initial: HistoryData,
  save: (data: HistoryData) => void = () => {}
): UploadHistoryStore => {
  let data = initial;
  const cache = new Map<string, StageStats | null>();
  return {
    lookup: (key) => {
      if (!cache.has(key)) cache.set(key, statsFrom(data[key] ?? []));
      return cache.get(key)!;
    },
    record: (key, record) => {
      if (!isValidRecord(record)) return;
      data = {
        ...data,
        [key]: [...(data[key] ?? []), record].slice(-MAX_RECORDS_PER_STAGE),
      };
      cache.delete(key);
      save(data);
    },
  };
};
