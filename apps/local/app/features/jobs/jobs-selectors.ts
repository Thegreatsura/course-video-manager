import type { uploadReducer } from "@/features/upload-manager/upload-reducer";
import {
  EXPORT_STAGE_BANDS,
  fillBand,
  RENDER_VERTICAL_STAGE_BANDS,
} from "@/features/upload-manager/upload-progress";
import {
  batchVideoRowId,
  isFinishedJob,
  type jobsReducer,
} from "./jobs-reducer";
import { isPostingJobKind } from "./job-wire";

/** The Jobs the author has not dismissed, oldest first by when this tab met them. */
export const visibleJobs = (state: jobsReducer.State): jobsReducer.JobView[] =>
  Object.values(state.jobs).filter((job) => !state.dismissed[job.id]);

/**
 * Every Upload Manager row the visible Jobs draw, minus the ones dismissed:
 * one per Job, or one per Video for a Batch export.
 */
export const visibleJobRows = (
  state: jobsReducer.State
): uploadReducer.UploadEntry[] =>
  visibleJobs(state)
    .flatMap(jobUploadEntries)
    .filter((row) => !state.dismissed[row.uploadId]);

/**
 * The newest visible row a Video's Jobs of `uploadType` draw: what a posting
 * page shows as "its" upload (a YouTube upload, an AI Hero post).
 */
export const findVideoJobRow = <T extends uploadReducer.UploadType>(
  state: jobsReducer.State,
  videoId: string,
  uploadType: T
): Extract<uploadReducer.UploadEntry, { uploadType: T }> | undefined =>
  visibleJobRows(state)
    .filter(
      (row): row is Extract<uploadReducer.UploadEntry, { uploadType: T }> =>
        row.videoId === videoId && row.uploadType === uploadType
    )
    .at(-1);

const EXPORT_STAGES: readonly string[] = Object.keys(EXPORT_STAGE_BANDS);

const isExportStage = (stage: string): stage is uploadReducer.ExportStage =>
  EXPORT_STAGES.includes(stage);

const RENDER_VERTICAL_STAGES: readonly string[] = Object.keys(
  RENDER_VERTICAL_STAGE_BANDS
);

const isRenderVerticalStage = (
  stage: string
): stage is uploadReducer.RenderVerticalStage =>
  RENDER_VERTICAL_STAGES.includes(stage);

const uploadStatusOf = (
  job: jobsReducer.JobView
): uploadReducer.UploadStatus => {
  switch (job.status) {
    case "requested":
    case "running":
      return "uploading";
    case "queued":
      // A post waiting for its export draws as the browser's did: waiting.
      if (job.dependsOn !== null) return "waiting";
      // Back in the queue after a failed attempt is a retry; the first wait,
      // or a wait after a stopping sidecar put it back, is just a queue.
      return job.errorMessage === null ? "uploading" : "retrying";
    case "retrying":
      return "retrying";
    case "succeeded":
      return "success";
    case "failed":
    case "interrupted":
      return "error";
  }
};

/** The fields every Job's row shares, whatever its kind. */
const baseEntryOf = (
  job: jobsReducer.JobView,
  status: uploadReducer.UploadStatus,
  progress: number
): uploadReducer.BaseUploadEntry => ({
  uploadId: job.id,
  videoId: job.subjectId ?? "",
  title: job.title,
  progress,
  status,
  errorMessage: job.errorMessage,
  retryCount: job.attempt - 1,
  terminal: false,
  dependsOn: job.dependsOn,
  parentUploadId: null,
});

const stringOf = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

/** An upload's bar: its percent while it runs, full once it is done. */
const uploadProgressOf = (
  job: jobsReducer.JobView,
  status: uploadReducer.UploadStatus
) => (status === "success" ? 100 : (job.percent ?? 0));

/**
 * A server Job as a row of the Global Upload Progress, which draws Upload
 * Manager entries. Each kind draws exactly as its browser-driven job did: the
 * same stages, bands and labels. `null` for a kind with no row.
 */
export const jobUploadEntry = (
  job: jobsReducer.JobView
): uploadReducer.UploadEntry | null => {
  switch (job.kind) {
    case "buffer": {
      const status = uploadStatusOf(job);
      return {
        ...baseEntryOf(job, status, uploadProgressOf(job, status)),
        uploadType: "buffer",
        bufferStage:
          status === "success"
            ? null
            : job.stage === "creating-post"
              ? "creating-post"
              : "uploading-blob",
      };
    }
    case "ai-hero": {
      const status = uploadStatusOf(job);
      return {
        ...baseEntryOf(job, status, uploadProgressOf(job, status)),
        uploadType: "ai-hero",
        aiHeroSlug: stringOf(job.result?.slug),
      };
    }
    case "skills-changelog": {
      const status = uploadStatusOf(job);
      return {
        ...baseEntryOf(job, status, uploadProgressOf(job, status)),
        uploadType: "skills-changelog",
        skillsChangelogSlug: stringOf(job.result?.slug),
      };
    }
    case "youtube":
    case "youtube-shorts": {
      const status = uploadStatusOf(job);
      return {
        ...baseEntryOf(job, status, uploadProgressOf(job, status)),
        uploadType: job.kind,
        youtubeVideoId: stringOf(job.result?.youtubeVideoId),
      };
    }
    case "render-vertical": {
      const stage =
        job.stage !== null && isRenderVerticalStage(job.stage)
          ? job.stage
          : null;
      const status = uploadStatusOf(job);
      // A render reports stages, not percentages: each stage is a floor.
      const progress =
        status === "success"
          ? 100
          : stage === null
            ? 0
            : RENDER_VERTICAL_STAGE_BANDS[stage].start;
      return {
        ...baseEntryOf(job, status, progress),
        uploadType: "render-vertical",
        renderVerticalStage: status === "success" ? null : stage,
      };
    }
    case "export": {
      const stage =
        job.stage !== null && isExportStage(job.stage) ? job.stage : null;
      const status = uploadStatusOf(job);
      const progress =
        status === "success"
          ? 100
          : stage === null
            ? 0
            : fillBand(EXPORT_STAGE_BANDS[stage], job.percent ?? 0);
      return {
        ...baseEntryOf(job, status, progress),
        uploadType: "export",
        exportStage: status === "uploading" ? (stage ?? "queued") : stage,
        isBatchEntry: false,
        videoUploadStage: null,
        uploadedBytes: 0,
        totalBytes: null,
      };
    }
    default:
      return null;
  }
};

/** A batch Video's row status, read with its batch's. */
const batchVideoStatusOf = (
  job: jobsReducer.JobView,
  video: jobsReducer.BatchVideoView
): uploadReducer.UploadStatus => {
  switch (video.status) {
    case "succeeded":
      return "success";
    case "failed":
      return "error";
    case "queued":
    case "running":
    case "handed-off":
      // A batch that ended without finishing a Video leaves it failed.
      return isFinishedJob(job) && job.status !== "succeeded"
        ? "error"
        : "uploading";
  }
};

/**
 * The rows a Job draws. A Batch export draws one export row per Video, as
 * the browser-driven batch did (`isBatchEntry`); a Video it handed on is
 * drawn by its own export Job instead. Every other kind draws one row.
 */
export const jobUploadEntries = (
  job: jobsReducer.JobView
): uploadReducer.UploadEntry[] => {
  if (job.kind !== "batch-export") {
    const entry = jobUploadEntry(job);
    return entry ? [entry] : [];
  }
  return (job.videos ?? []).flatMap(
    (video): uploadReducer.ExportUploadEntry[] => {
      if (video.status === "handed-off") return [];
      const status = batchVideoStatusOf(job, video);
      const stage =
        video.stage !== null && isExportStage(video.stage) ? video.stage : null;
      const progress =
        status === "success"
          ? 100
          : stage === null
            ? 0
            : fillBand(EXPORT_STAGE_BANDS[stage], video.percent ?? 0);
      return [
        {
          uploadId: batchVideoRowId(job.id, video.id),
          videoId: video.id,
          title: video.title,
          progress,
          status,
          errorMessage:
            video.errorMessage ??
            (status === "error" ? job.errorMessage : null),
          retryCount: 0,
          terminal: false,
          dependsOn: null,
          parentUploadId: null,
          uploadType: "export",
          exportStage: status === "uploading" ? (stage ?? "queued") : stage,
          isBatchEntry: true,
          videoUploadStage: null,
          uploadedBytes: 0,
          totalBytes: null,
        },
      ];
    }
  );
};

/**
 * Failures a Retry cannot fix: a dead or missing key (fix it, then post again
 * from the page), or an export that never finished (its post never started).
 */
const RETRY_CANNOT_HELP: readonly string[] = [
  "BufferAuthError",
  "NotAuthenticatedError",
  "YouTubeAuthError",
  "AiHeroNotAuthenticatedError",
  "DependencyFailed",
];

/** A failure from before the post sent anything: nothing can have gone out. */
const NOTHING_SENT: readonly string[] = ["PostNotStartedError"];

/**
 * What a failed or cut-off POST's row offers (decision 5: "Posting twice
 * would be disastrous"), or `null` for any other Job.
 *
 * - `went-out`: this run's post reached the service — it said so (`posted`)
 *   before it failed, or the post-check found it. No Retry: it would post
 *   twice (the server refuses it too).
 * - `cannot-help`: fix the key, or the export, then post again from the page.
 * - `retry`: asks "Post again?" first unless the failure came before anything
 *   was sent. A "not posted" check does not skip the question: a check can
 *   run before a cut-off request has landed, and a failed run is never
 *   looked for at all.
 */
export type PostRetry =
  | { readonly type: "went-out"; readonly url: string | null }
  | { readonly type: "cannot-help" }
  | { readonly type: "retry"; readonly confirm: boolean };

export const postRetryOf = (job: jobsReducer.JobView): PostRetry | null => {
  if (!isPostingJobKind(job.kind)) return null;
  if (job.status !== "failed" && job.status !== "interrupted") return null;
  if (job.result !== null) {
    return { type: "went-out", url: stringOf(job.result.url) };
  }
  if (job.postCheck?.verdict === "posted") {
    return { type: "went-out", url: job.postCheck.url };
  }
  if (RETRY_CANNOT_HELP.includes(job.errorTag ?? "")) {
    return { type: "cannot-help" };
  }
  return {
    type: "retry",
    confirm: !NOTHING_SENT.includes(job.errorTag ?? ""),
  };
};
