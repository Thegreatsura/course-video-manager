import type {
  AutofillStage,
  ExportStage,
  PublishStage,
  RenderVerticalStage,
  UploadEntry,
  UploadType,
} from "./upload-entry";
import {
  AUTOFILL_STAGE_BANDS,
  PUBLISH_STAGE_BANDS,
  PUBLISH_VIDEO_UPLOAD_BANDS,
  RENDER_VERTICAL_STAGE_BANDS,
  exportStageBands,
  fillBand,
  withDerivedParentProgress,
} from "./upload-progress";
import { trackTimings, type TimedRows } from "./upload-timing";

/**
 * Rows moving over time, for the timing and ETA tests: each step changes the
 * rows the way a Job's events move them (`jobUploadEntries`), at a clock
 * reading of its own.
 */

type Rows = Record<string, UploadEntry>;

export interface RowChange {
  apply: (rows: Rows) => Rows;
  /** The row an export event names: it has an encode to do. */
  exportWorkId?: string;
}

export type RowStep = [at: number | undefined, change: RowChange];

/** Apply each step at its clock reading, tracking the timings as it goes. */
export const replay = (
  steps: readonly RowStep[],
  from: TimedRows = { uploads: {}, timings: {} }
): TimedRows =>
  steps.reduce((previous, [at, change]) => {
    const uploads = withDerivedParentProgress(change.apply(previous.uploads));
    return {
      uploads,
      timings: trackTimings(previous, uploads, {
        at,
        exportWorkId: change.exportWorkId,
      }),
    };
  }, from);

const newRow = (
  uploadId: string,
  uploadType: UploadType,
  options: { parentUploadId?: string; isBatchEntry?: boolean }
): UploadEntry => {
  const base = {
    uploadId,
    videoId: uploadId,
    title: uploadId,
    progress: 0,
    status: "uploading" as const,
    errorMessage: null,
    retryCount: 0,
    terminal: false,
    dependsOn: null,
    parentUploadId: options.parentUploadId ?? null,
  };
  switch (uploadType) {
    case "youtube":
    case "youtube-shorts":
      return { ...base, uploadType, youtubeVideoId: null };
    case "buffer":
      return { ...base, uploadType, bufferStage: "uploading-blob" };
    case "ai-hero":
      return { ...base, uploadType, aiHeroSlug: null };
    case "skills-changelog":
      return { ...base, uploadType, skillsChangelogSlug: null };
    case "export":
      return {
        ...base,
        uploadType,
        exportStage: "queued",
        isBatchEntry: options.isBatchEntry ?? false,
        videoUploadStage: null,
        uploadedBytes: 0,
        totalBytes: null,
      };
    case "publish":
      return {
        ...base,
        uploadType,
        publishStage: "validating",
        newDraftVersionId: null,
        courseId: "c",
      };
    case "autofill":
      return {
        ...base,
        uploadType,
        autofillStage: options.parentUploadId ? "writing" : "selecting",
        courseId: "c",
        kept: [],
      };
    case "render-vertical":
      return {
        ...base,
        uploadType,
        renderVerticalStage: "concatenating-clips",
      };
    case "duplicate-course":
      return {
        ...base,
        uploadType,
        duplicateCourseStage: "copying-rows",
        courseId: "c",
      };
  }
};

const update = (
  uploadId: string,
  change: (row: UploadEntry) => UploadEntry
): RowChange["apply"] => {
  return (rows) => {
    const row = rows[uploadId];
    return row ? { ...rows, [uploadId]: change(row) } : rows;
  };
};

const exportRow = (row: UploadEntry) => {
  if (row.uploadType !== "export") throw new Error("not an export row");
  return row;
};

/** A row appears. */
export const start = (
  uploadId: string,
  uploadType: UploadType,
  options: { parentUploadId?: string; isBatchEntry?: boolean } = {}
): RowChange => ({
  apply: (rows) => ({
    ...rows,
    [uploadId]: newRow(uploadId, uploadType, options),
  }),
});

/** A row's bar moves to `progress`. */
export const progress = (uploadId: string, value: number): RowChange => ({
  apply: update(uploadId, (row) => ({ ...row, progress: value })),
});

/** An export row enters `stage`. */
export const exportStage = (
  uploadId: string,
  stage: ExportStage
): RowChange => ({
  apply: update(uploadId, (row) => {
    const entry = exportRow(row);
    return {
      ...entry,
      exportStage: stage,
      progress: Math.max(entry.progress, exportStageBands(entry)[stage].start),
    };
  }),
  exportWorkId: uploadId,
});

/** An export row is `percent` of the way through `stage`. */
export const exportProgress = (
  uploadId: string,
  stage: Exclude<ExportStage, "queued">,
  percent: number
): RowChange => ({
  apply: update(uploadId, (row) => {
    const entry = exportRow(row);
    return {
      ...entry,
      exportStage: stage,
      progress: Math.max(
        entry.progress,
        fillBand(exportStageBands(entry)[stage], percent)
      ),
    };
  }),
  exportWorkId: uploadId,
});

/** A Publish's Video has moved `uploadedBytes` of its `totalBytes`. */
export const videoUploadProgress = (
  uploadId: string,
  uploadedBytes: number,
  totalBytes: number
): RowChange => ({
  apply: update(uploadId, (row) => {
    const entry = exportRow(row);
    return {
      ...entry,
      exportStage: null,
      videoUploadStage: "uploading",
      uploadedBytes,
      totalBytes,
      progress: Math.max(
        entry.progress,
        fillBand(
          PUBLISH_VIDEO_UPLOAD_BANDS.uploading,
          totalBytes > 0 ? (uploadedBytes / totalBytes) * 100 : 0
        )
      ),
    };
  }),
});

/** A Publish enters `stage`. */
export const publishStage = (
  uploadId: string,
  stage: PublishStage
): RowChange => ({
  apply: update(uploadId, (row) =>
    row.uploadType === "publish"
      ? {
          ...row,
          publishStage: stage,
          progress: Math.max(row.progress, PUBLISH_STAGE_BANDS[stage].start),
        }
      : row
  ),
});

/** An Autofill row enters `stage`. */
export const autofillStage = (
  uploadId: string,
  stage: AutofillStage
): RowChange => ({
  apply: update(uploadId, (row) =>
    row.uploadType === "autofill"
      ? {
          ...row,
          autofillStage: stage,
          progress: Math.max(row.progress, AUTOFILL_STAGE_BANDS[stage].start),
        }
      : row
  ),
});

/** A vertical render enters `stage`. */
export const renderStage = (
  uploadId: string,
  stage: RenderVerticalStage
): RowChange => ({
  apply: update(uploadId, (row) =>
    row.uploadType === "render-vertical"
      ? {
          ...row,
          renderVerticalStage: stage,
          progress: Math.max(
            row.progress,
            RENDER_VERTICAL_STAGE_BANDS[stage].start
          ),
        }
      : row
  ),
});

/** A row succeeds: its bar fills and it has no stage left. */
export const succeed = (uploadId: string): RowChange => ({
  apply: update(uploadId, (row) => {
    const done = { ...row, status: "success" as const, progress: 100 };
    switch (done.uploadType) {
      case "export":
        return { ...done, exportStage: null, videoUploadStage: null };
      case "publish":
        return { ...done, publishStage: null };
      case "render-vertical":
        return { ...done, renderVerticalStage: null };
      case "duplicate-course":
        return { ...done, duplicateCourseStage: null };
      case "buffer":
        return { ...done, bufferStage: null };
      case "autofill":
      case "youtube":
      case "youtube-shorts":
      case "ai-hero":
      case "skills-changelog":
        return done;
    }
  }),
});

/** A row fails for good. */
export const fail = (uploadId: string): RowChange => ({
  apply: update(uploadId, (row) => ({
    ...row,
    status: "error",
    terminal: true,
    errorMessage: "boom",
  })),
});

/** A row is dismissed. */
export const dismiss = (uploadId: string): RowChange => ({
  apply: (rows) => {
    const { [uploadId]: _, ...rest } = rows;
    return rest;
  },
});
