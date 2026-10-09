import type { uploadReducer } from "@/features/upload-manager/upload-reducer";
import {
  AUTOFILL_STAGE_BANDS,
  AUTOFILL_WORK_BAND,
  EXPORT_STAGE_BANDS,
  fillBand,
  RENDER_VERTICAL_STAGE_BANDS,
} from "@/features/upload-manager/upload-progress";
import {
  batchVideoRowId,
  isFinishedJob,
  type jobsReducer,
} from "./jobs-reducer";

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
 * The newest Job of `kind` about one subject (a Course's Autofill), known to
 * this tab — started here, or met in the stream's snapshot after a reload.
 */
export const latestJobFor = (
  state: jobsReducer.State,
  kind: string,
  subjectId: string
): jobsReducer.JobView | undefined =>
  Object.values(state.jobs)
    .filter((job) => job.kind === kind && job.subjectId === subjectId)
    .at(-1);

const AUTOFILL_STAGES: readonly string[] = Object.keys(AUTOFILL_STAGE_BANDS);

const isAutofillStage = (stage: string): stage is uploadReducer.AutofillStage =>
  AUTOFILL_STAGES.includes(stage);

/**
 * A Course Autofill as the browser-driven run drew it: a parent row whose bar
 * is its Videos, and one child row per **Autofill Candidate** under it
 * (`parentUploadId`). A Video's row has no finer progress than "writing";
 * it ends filled or failed, never retried.
 */
const autofillUploadEntries = (
  job: jobsReducer.JobView
): uploadReducer.AutofillUploadEntry[] => {
  const status = uploadStatusOf(job);
  const courseId = job.subjectId ?? "";
  const children = (job.videos ?? []).map(
    (video): uploadReducer.AutofillUploadEntry => {
      const videoStatus = batchVideoStatusOf(job, video);
      return {
        uploadId: batchVideoRowId(job.id, video.id),
        videoId: video.id,
        title: video.title,
        progress:
          videoStatus === "success" ? 100 : AUTOFILL_STAGE_BANDS.writing.start,
        status: videoStatus,
        errorMessage:
          video.errorMessage ??
          (videoStatus === "error" ? job.errorMessage : null),
        retryCount: 0,
        terminal: videoStatus === "error",
        dependsOn: null,
        parentUploadId: job.id,
        uploadType: "autofill",
        autofillStage: videoStatus === "success" ? null : "writing",
        courseId,
      };
    }
  );
  const stage =
    job.stage !== null && isAutofillStage(job.stage) ? job.stage : null;
  // A Video that has settled, either way, is work done.
  const settled = children.filter(
    (child) => child.status === "success" || child.status === "error"
  ).length;
  const progress =
    status === "success"
      ? 100
      : stage === "writing" && children.length > 0
        ? fillBand(AUTOFILL_WORK_BAND, (100 * settled) / children.length)
        : stage === null
          ? 0
          : AUTOFILL_STAGE_BANDS[stage].start;
  const parent: uploadReducer.AutofillUploadEntry = {
    ...baseEntryOf(job, status, progress),
    // The parent names a Course, not a Video.
    videoId: "",
    terminal: status === "error",
    uploadType: "autofill",
    autofillStage: status === "success" ? null : (stage ?? "selecting"),
    courseId,
  };
  return [parent, ...children];
};

/**
 * The rows a Job draws. A Batch export draws one export row per Video, as
 * the browser-driven batch did (`isBatchEntry`); a Video it handed on is
 * drawn by its own export Job instead. An Autofill draws a parent row and a
 * child row per Video. Every other kind draws one row.
 */
export const jobUploadEntries = (
  job: jobsReducer.JobView
): uploadReducer.UploadEntry[] => {
  if (job.kind === "autofill") return autofillUploadEntries(job);
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
