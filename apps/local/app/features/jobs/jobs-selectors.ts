import type { uploadReducer } from "@/features/upload-manager/upload-reducer";
import {
  EXPORT_STAGE_BANDS,
  fillBand,
  RENDER_VERTICAL_STAGE_BANDS,
} from "@/features/upload-manager/upload-progress";
import type { jobsReducer } from "./jobs-reducer";

/** The Jobs the author has not dismissed, oldest first by when this tab met them. */
export const visibleJobs = (state: jobsReducer.State): jobsReducer.JobView[] =>
  Object.values(state.jobs).filter((job) => !state.dismissed[job.id]);

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
  dependsOn: null,
  parentUploadId: null,
});

/**
 * A server Job as a row of the Global Upload Progress, which draws Upload
 * Manager entries. Each kind draws exactly as its browser-driven job did: the
 * same stages, bands and labels. `null` for a kind with no row.
 */
export const jobUploadEntry = (
  job: jobsReducer.JobView
):
  | uploadReducer.ExportUploadEntry
  | uploadReducer.RenderVerticalUploadEntry
  | null => {
  switch (job.kind) {
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
