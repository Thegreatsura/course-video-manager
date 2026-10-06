import type { uploadReducer } from "./upload-reducer";
import {
  historyKey,
  isWaitStage,
  stageUnits,
  timingStage,
} from "./upload-eta-stages";

/**
 * What the reducer remembers about *when* things happened to each job, so the
 * ETA selector has something to work from. Every timestamp comes from the
 * action's `at`, stamped by the provider's injected clock — the reducer never
 * reads a clock itself.
 */

export interface ProgressSample {
  at: number;
  progress: number;
}

/** A stage this job finished, ready to be written to the stage history. */
export interface CompletedStage {
  key: string;
  durationMs: number;
  units: number | null;
}

export interface UploadTiming {
  /** See `timingStage`. `null` once the job is no longer running. */
  stage: string | null;
  stageStartedAt: number;
  stageStartProgress: number;
  /** Bar positions seen during this stage, trimmed to a sliding window. */
  samples: ProgressSample[];
  completed: CompletedStage[];
  /** Set once an export event names this job: it has an encode to do. */
  needsExport: boolean;
  /** When the job stopped running. */
  endedAt: number | null;
}

/** How far back the live rate looks. Long enough that a burst averages out. */
export const SAMPLE_WINDOW_MS = 30_000;
const MAX_SAMPLES = 60;

const trimSamples = (samples: ProgressSample[]): ProgressSample[] => {
  const last = samples[samples.length - 1]!;
  const inWindow = samples.filter((s) => s.at >= last.at - SAMPLE_WINDOW_MS);
  const kept = inWindow.length >= 2 ? inWindow : samples.slice(-2);
  return kept.slice(-MAX_SAMPLES);
};

const startStage = (
  stage: string | null,
  progress: number,
  at: number
): Pick<
  UploadTiming,
  "stage" | "stageStartedAt" | "stageStartProgress" | "samples" | "endedAt"
> => ({
  stage,
  stageStartedAt: at,
  stageStartProgress: progress,
  samples: [{ at, progress }],
  endedAt: stage === null ? at : null,
});

const isExportWork = (action: uploadReducer.Action) =>
  action.type === "UPDATE_EXPORT_STAGE" ||
  action.type === "UPDATE_EXPORT_PROGRESS";

const nextTiming = (
  previous: uploadReducer.State,
  uploads: uploadReducer.State["uploads"],
  id: string,
  action: uploadReducer.Action,
  at: number
): UploadTiming => {
  const entry = uploads[id]!;
  const old = previous.timings[id];
  const stage = timingStage(entry, uploads);
  const restarted =
    (action.type === "START_UPLOAD" || action.type === "RETRY") &&
    action.uploadId === id;

  let timing: UploadTiming;
  if (!old || restarted) {
    timing = {
      ...startStage(stage, entry.progress, at),
      completed: [],
      needsExport: false,
    };
  } else if (stage !== old.stage) {
    // Only a stage that ended in the job moving on counts as a duration. A
    // stage cut short by a failure or a retry says nothing about how long
    // that stage takes.
    const finishedCleanly =
      old.stage !== null &&
      !isWaitStage(old.stage) &&
      (entry.status === "uploading" || entry.status === "success");
    timing = {
      ...old,
      ...startStage(stage, entry.progress, at),
      completed: finishedCleanly
        ? [
            ...old.completed,
            {
              key: historyKey(entry, old.stage!),
              durationMs: at - old.stageStartedAt,
              units: stageUnits(previous.uploads[id] ?? entry, old.stage!),
            },
          ]
        : old.completed,
    };
  } else if (
    stage !== null &&
    entry.progress !== old.samples[old.samples.length - 1]?.progress
  ) {
    timing = {
      ...old,
      samples: trimSamples([...old.samples, { at, progress: entry.progress }]),
    };
  } else {
    timing = old;
  }

  if (
    isExportWork(action) &&
    "uploadId" in action &&
    action.uploadId === id &&
    !timing.needsExport
  ) {
    timing = { ...timing, needsExport: true };
  }
  return timing;
};

/**
 * The timings after an action. Without an `at` there is no clock reading to
 * record against, so the timings only lose the jobs that are gone.
 */
export const trackTimings = (
  previous: uploadReducer.State,
  uploads: uploadReducer.State["uploads"],
  action: uploadReducer.Action
): uploadReducer.State["timings"] => {
  const at = action.at;
  let changed = Object.keys(previous.timings).some((id) => !uploads[id]);
  const next: uploadReducer.State["timings"] = {};
  for (const id of Object.keys(uploads)) {
    const timing =
      at === undefined
        ? previous.timings[id]
        : nextTiming(previous, uploads, id, action, at);
    if (!timing) continue;
    if (timing !== previous.timings[id]) changed = true;
    next[id] = timing;
  }
  return changed ? next : previous.timings;
};
