import type { uploadReducer } from "./upload-reducer";
import {
  AUTOFILL_POOL_CONCURRENCY,
  ENCODE_STAGES,
  EXPORT_POOL_CONCURRENCY,
  UPLOAD_POOL_CONCURRENCY,
  isParentJob,
  stageBand,
} from "./upload-eta-stages";
import {
  ESTIMATING,
  NO_ETA,
  blendedRemaining,
  currentStageRemaining,
  expectedStageMs,
  jobEta,
  type EtaContext,
  type UploadEta,
} from "./upload-eta";

/**
 * ETAs for jobs that wait on a pool: a parent's children, and the Videos of an
 * Export All. Each pool is replayed forward with the concurrency its runner
 * really uses —
 *
 * - encodes: `EXPORT_POOL_CONCURRENCY` at a time, in roster order;
 * - a Publish's uploads: `UPLOAD_POOL_CONCURRENCY` slots taken in roster
 *   order, each slot held while its Video waits for its own encode (that is
 *   how the server's `Effect.forEach` over `awaitVideoReady` behaves);
 * - an Autofill's Videos: `AUTOFILL_POOL_CONCURRENCY` at a time.
 *
 * Times are milliseconds from now. Any job without a basis makes the whole
 * schedule `null`, rather than a schedule that quietly leaves it out.
 */

type Entry = uploadReducer.UploadEntry;
type Finishes = Map<string, number>;

/** List scheduling: each job takes the slot that frees first. */
const runPool = (
  busyUntil: number[],
  concurrency: number,
  jobs: Array<{ id: string; readyAt: number; durationMs: number }>,
  finishes: Finishes
) => {
  const slots = [...busyUntil];
  while (slots.length < concurrency) slots.push(0);
  for (const job of jobs) {
    slots.sort((a, b) => a - b);
    const start = Math.max(slots.shift()!, job.readyAt);
    const finish = start + job.durationMs;
    slots.push(finish);
    finishes.set(job.id, finish);
  }
};

/** A stage's time left, where overdue counts as about to finish. */
const remainingOrNull = (upload: Entry, context: EtaContext) => {
  const timing = context.timings[upload.uploadId];
  if (!timing) return null;
  const left = currentStageRemaining(upload, timing, context);
  if (left === "overdue") return 0;
  return typeof left === "number" ? left : null;
};

/** The encode still ahead of an export, by its live stage and history. */
const encodeRemaining = (upload: Entry, context: EtaContext) => {
  const stage = context.timings[upload.uploadId]?.stage;
  const normalize = expectedStageMs(
    upload,
    "normalizing-audio",
    context.history
  );
  if (stage === "normalizing-audio") return remainingOrNull(upload, context);
  if (stage === "concatenating-clips") {
    const now = remainingOrNull(upload, context);
    return now === null || normalize === null ? null : now + normalize;
  }
  const concat = expectedStageMs(
    upload,
    "concatenating-clips",
    context.history
  );
  return concat === null || normalize === null ? null : concat + normalize;
};

/** Exports yet to finish encoding, through the encode pool. */
const scheduleEncodes = (exports: Entry[], context: EtaContext) => {
  const finishes: Finishes = new Map();
  const running: number[] = [];
  const queued: Array<{ id: string; readyAt: number; durationMs: number }> = [];
  for (const upload of exports) {
    const left = encodeRemaining(upload, context);
    if (left === null) return null;
    const stage = context.timings[upload.uploadId]?.stage ?? "queued";
    if (ENCODE_STAGES.includes(stage)) {
      running.push(left);
      finishes.set(upload.uploadId, left);
    } else {
      queued.push({ id: upload.uploadId, readyAt: 0, durationMs: left });
    }
  }
  runPool(running, EXPORT_POOL_CONCURRENCY, queued, finishes);
  return finishes;
};

const isRunning = (upload: Entry) => upload.status === "uploading";

const schedulePublish = (children: Entry[], context: EtaContext) => {
  const active = children.filter(isRunning);
  const stageOf = (u: Entry) => context.timings[u.uploadId]?.stage ?? "queued";
  const encoding = active.filter(
    (u) =>
      context.timings[u.uploadId]?.needsExport &&
      (stageOf(u) === "queued" || ENCODE_STAGES.includes(stageOf(u)))
  );
  const readyAt = scheduleEncodes(encoding, context);
  if (!readyAt) return null;

  const finishes: Finishes = new Map();
  const uploading: number[] = [];
  const waiting: Array<{ id: string; readyAt: number; durationMs: number }> =
    [];
  for (const upload of active) {
    if (stageOf(upload) === "uploading") {
      const left = remainingOrNull(upload, context);
      if (left === null) return null;
      uploading.push(left);
      finishes.set(upload.uploadId, left);
      continue;
    }
    const durationMs = expectedStageMs(upload, "uploading", context.history);
    if (durationMs === null) return null;
    waiting.push({
      id: upload.uploadId,
      readyAt: readyAt.get(upload.uploadId) ?? 0,
      durationMs,
    });
  }
  runPool(uploading, UPLOAD_POOL_CONCURRENCY, waiting, finishes);
  return finishes;
};

const scheduleAutofill = (children: Entry[], context: EtaContext) => {
  const active = children.filter(isRunning);
  if (active.length === 0) return new Map<string, number>();
  const durationMs = expectedStageMs(active[0]!, "writing", context.history);
  if (durationMs === null) return null;
  // The rows do not say which Videos hold a slot, so credit the first few with
  // the time since the later of their creation and the last sibling to
  // finish — a lower bound on how long they have been running.
  const lastSettled = Math.max(
    -Infinity,
    ...children.map((u) => context.timings[u.uploadId]?.endedAt ?? -Infinity)
  );
  const running = active.slice(0, AUTOFILL_POOL_CONCURRENCY);
  const finishes: Finishes = new Map();
  const busy = running.map((u) => {
    const started = Math.max(
      context.timings[u.uploadId]?.stageStartedAt ?? context.now,
      lastSettled
    );
    const left = Math.max(0, durationMs - (context.now - started));
    finishes.set(u.uploadId, left);
    return left;
  });
  const rest = active
    .slice(AUTOFILL_POOL_CONCURRENCY)
    .map((u) => ({ id: u.uploadId, readyAt: 0, durationMs }));
  runPool(busy, AUTOFILL_POOL_CONCURRENCY, rest, finishes);
  return finishes;
};

const jobScoped = (ms: number): UploadEta =>
  ms > 0 ? { kind: "remaining", ms, scope: "job" } : ESTIMATING;

/**
 * A parent mid-`work`: its children's schedule blended with its own bar's
 * live rate, plus history for what follows the children (a Publish's commit).
 */
const parentEta = (
  parent: Entry,
  schedule: Finishes | null,
  context: EtaContext
): UploadEta => {
  const timing = context.timings[parent.uploadId];
  if (!timing || timing.stage !== "work")
    return jobEta(parent, timing, context);
  const band = stageBand(parent, "work")!;
  const scheduled = schedule ? Math.max(0, ...schedule.values()) : null;
  const work = blendedRemaining(timing, band, scheduled, context.now);
  if (work === "overdue" || work === "gathering") return ESTIMATING;
  if (typeof work !== "number") return NO_ETA;
  if (parent.uploadType === "autofill") return jobScoped(work);
  const tail = expectedStageMs(parent, "finalizing", context.history);
  return tail === null
    ? { kind: "remaining", ms: work, scope: "stage" }
    : jobScoped(work + tail);
};

/**
 * Every job's ETA, keyed by `uploadId`. Pure: the clock is `context.now`, the
 * past is `context.history`.
 */
export const estimateUploads = (
  uploads: Record<string, Entry>,
  context: EtaContext
): Record<string, UploadEta> => {
  const all = Object.values(uploads);
  const etas: Record<string, UploadEta> = {};
  for (const upload of all) {
    etas[upload.uploadId] = jobEta(
      upload,
      context.timings[upload.uploadId],
      context
    );
  }

  const applySchedule = (schedule: Finishes | null) => {
    for (const [id, ms] of schedule ?? []) etas[id] = jobScoped(ms);
  };

  for (const parent of all.filter(isParentJob)) {
    if (!isRunning(parent)) continue;
    const children = all.filter((u) => u.parentUploadId === parent.uploadId);
    const schedule =
      parent.uploadType === "publish"
        ? schedulePublish(children, context)
        : scheduleAutofill(children, context);
    applySchedule(schedule);
    etas[parent.uploadId] = parentEta(parent, schedule, context);
  }

  // Export All has no parent row, but its Videos still share one encode pool.
  const exportAll = all.filter(
    (u) =>
      u.uploadType === "export" &&
      u.isBatchEntry &&
      !u.parentUploadId &&
      isRunning(u)
  );
  if (exportAll.length > 0) applySchedule(scheduleEncodes(exportAll, context));

  return etas;
};

/**
 * When everything in flight should be done: the longest job-scoped ETA among
 * the top-level jobs, or `null` unless every one of them has one.
 */
export const allDoneEta = (
  uploads: Record<string, Entry>,
  etas: Record<string, UploadEta>
): number | null => {
  const roots = Object.values(uploads).filter(
    (u) => !u.parentUploadId && u.status !== "success" && u.status !== "error"
  );
  if (roots.length === 0) return null;
  let longest = 0;
  for (const root of roots) {
    const eta = etas[root.uploadId];
    if (eta?.kind !== "remaining" || eta.scope !== "job") return null;
    longest = Math.max(longest, eta.ms);
  }
  return longest;
};
