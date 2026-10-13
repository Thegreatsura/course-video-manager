import type { jobsReducer } from "@/features/jobs/jobs-reducer";
import { visibleJobs } from "@/features/jobs/jobs-selectors";
import {
  STORAGE_DELETE_JOB_KIND,
  STORAGE_MOVE_JOB_KIND,
  storageDeleteSummary,
  type StorageDeleteJobResult,
  type StorageMoveResult,
} from "@/packages/storage/client";

/**
 * FOLLOWING STORAGE JOBS ON THE STORAGE PAGES (#2157). A move or a delete
 * runs as a Sidecar Job; the pages draw it live from the tab's Job Events
 * (the same `jobsReducer` state the Upload Manager draws), with its Cancel
 * and its result, and count again once it settles. Pure, no React.
 */

const STORAGE_JOB_KINDS: readonly string[] = [
  STORAGE_MOVE_JOB_KIND,
  STORAGE_DELETE_JOB_KIND,
];

/** One storage Job as a page draws it. */
export type StorageJobView = {
  readonly id: string;
  readonly kind: "move" | "delete";
  readonly title: string;
  readonly bucketId: string | null;
  /** Queued or running (or asked to stop): not settled yet. */
  readonly live: boolean;
  readonly status: jobsReducer.JobStatus;
  readonly stage: string | null;
  /** 0-100 within its stage, or null before it reports. */
  readonly percent: number | null;
  /** Cancel is offered: live, and not asked already. */
  readonly cancellable: boolean;
  readonly cancelRequested: boolean;
  /** "2 deleted (5.0 GB); 1 file still on D:, retry", once reported. */
  readonly summary: string | null;
  /** Files it could not move or delete, and why. */
  readonly left: readonly { path: string; message: string }[];
  readonly errorMessage: string | null;
};

const isLive = (status: jobsReducer.JobStatus) =>
  status === "requested" ||
  status === "queued" ||
  status === "running" ||
  status === "retrying";

const gbOrMb = (bytes: number) =>
  bytes >= 1024 ** 3
    ? `${(bytes / 1024 ** 3).toFixed(1)} GB`
    : `${(bytes / 1024 ** 2).toFixed(1)} MB`;

const summaryOf = (
  job: jobsReducer.JobView,
  labelOf: (location: string) => string
): { summary: string | null; left: StorageJobView["left"] } => {
  const result = job.result;
  if (result === null) return { summary: null, left: [] };
  if (job.kind === STORAGE_DELETE_JOB_KIND) {
    const r = result as unknown as StorageDeleteJobResult;
    return {
      summary: storageDeleteSummary(
        r,
        r.location === null ? "its drive" : labelOf(r.location)
      ),
      left: r.left ?? [],
    };
  }
  const r = result as unknown as StorageMoveResult;
  return {
    summary: `${r.copied.files} copied (${gbOrMb(r.copied.bytes)}), ${r.verified.files} already there and verified; originals kept`,
    left: r.left ?? [],
  };
};

/**
 * The storage Jobs this tab knows of, newest first: every one on the Storage
 * page (`bucketId` null), or one bucket's on its page. Dismissed Jobs are
 * not shown. `shownOf` keeps the ones a page draws: live, or seen live.
 */
export const storageJobsOf = (
  jobs: jobsReducer.State,
  bucketId: string | null,
  labelOf: (location: string) => string
): StorageJobView[] =>
  visibleJobs(jobs)
    .filter(
      (job) =>
        STORAGE_JOB_KINDS.includes(job.kind) &&
        (bucketId === null || job.subjectId === bucketId)
    )
    .reverse()
    .map((job): StorageJobView => {
      const live = isLive(job.status);
      return {
        id: job.id,
        kind: job.kind === STORAGE_MOVE_JOB_KIND ? "move" : "delete",
        title: job.title,
        bucketId: job.subjectId,
        live,
        status: job.status,
        stage: job.stage,
        percent: job.percent,
        cancellable: live && job.status !== "requested" && !job.cancelRequested,
        cancelRequested: live && job.cancelRequested,
        ...summaryOf(job, labelOf),
        errorMessage: job.errorMessage,
      };
    });

/** What a page reports of the storage Jobs it can see. */
export type ObservedStorageJob = {
  readonly id: string;
  readonly live: boolean;
};

export const observedStorageJobs = (
  views: readonly StorageJobView[]
): ObservedStorageJob[] => views.map((v) => ({ id: v.id, live: v.live }));

/**
 * The Jobs a page has seen live, and whether one just settled: then the
 * page counts again from nothing. A Job first seen already settled (from
 * before the page opened) changes nothing.
 */
export const watchStorageJobs = (
  watched: Readonly<Record<string, boolean>>,
  observed: readonly ObservedStorageJob[]
): { watched: Record<string, boolean>; settled: boolean } => {
  const next: Record<string, boolean> = { ...watched };
  let settled = false;
  for (const job of observed) {
    if (job.live) next[job.id] = true;
    else if (next[job.id] === true) {
      next[job.id] = false;
      settled = true;
    }
  }
  return { watched: next, settled };
};

/** The Jobs a page draws: live ones, and settled ones it saw run. */
export const shownStorageJobs = (
  views: readonly StorageJobView[],
  watched: Readonly<Record<string, boolean>>
): StorageJobView[] => views.filter((v) => v.live || v.id in watched);
