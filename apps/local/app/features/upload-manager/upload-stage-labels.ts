import type {
  AutofillStage,
  BufferStage,
  DuplicateCourseStage,
  StorageDeleteStage,
  StorageMoveStage,
  ExportStage,
  PublishStage,
  RenderVerticalStage,
  UploadEntry,
  VideoUploadStage,
} from "./upload-entry";

const BUFFER_STAGE_LABELS: Record<BufferStage, string> = {
  "uploading-blob": "Uploading to cloud",
  "creating-post": "Creating Buffer post",
  polling: "Waiting for delivery",
  "cleaning-up": "Cleaning up",
};

const EXPORT_STAGE_LABELS: Record<ExportStage, string> = {
  queued: "Queued",
  "concatenating-clips": "Concatenating clips",
  "normalizing-audio": "Normalizing audio",
};

const VIDEO_UPLOAD_STAGE_LABELS: Record<VideoUploadStage, string> = {
  "queued-for-upload": "Waiting to upload",
  uploading: "Uploading to Dropbox",
};

const PUBLISH_STAGE_LABELS: Record<PublishStage, string> = {
  validating: "Validating",
  exporting: "Exporting videos",
  uploading: "Uploading to Dropbox",
  freezing: "Freezing version",
  cloning: "Creating new draft",
  complete: "Finishing up",
};

const AUTOFILL_STAGE_LABELS: Record<AutofillStage, string> = {
  selecting: "Choosing videos",
  writing: "Writing missing text",
};

const RENDER_VERTICAL_STAGE_LABELS: Record<RenderVerticalStage, string> = {
  "concatenating-clips": "Concatenating clips",
  "rendering-overlay": "Rendering subtitles",
  compositing: "Compositing video",
};

const DUPLICATE_COURSE_STAGE_LABELS: Record<DuplicateCourseStage, string> = {
  "copying-rows": "Copying lessons and videos",
  "copying-files": "Copying frames and files",
};

/**
 * What an in-flight job is doing right now, for the label beside its progress
 * bar. `null` when the job type has no stages (a plain upload streams a real
 * byte percentage, so the bar alone says everything) or when a staged job has
 * not reported its first stage yet.
 */
const STORAGE_MOVE_STAGE_LABELS: Record<StorageMoveStage, string> = {
  checking: "Checking room and running work",
  copying: "Copying and verifying checksums",
};

const STORAGE_DELETE_STAGE_LABELS: Record<StorageDeleteStage, string> = {
  checking: "Checking running work",
  deleting: "Checking each file against its copy, then deleting",
};

export function uploadStageLabel(upload: UploadEntry): string | null {
  switch (upload.uploadType) {
    case "export":
      // A per-Video task under a Publish encodes first and uploads after, so
      // its upload stage — once it has one — is the later word on what it is
      // doing.
      if (upload.videoUploadStage) {
        return VIDEO_UPLOAD_STAGE_LABELS[upload.videoUploadStage];
      }
      return upload.exportStage
        ? EXPORT_STAGE_LABELS[upload.exportStage]
        : null;
    case "publish":
      return upload.publishStage
        ? PUBLISH_STAGE_LABELS[upload.publishStage]
        : null;
    case "autofill":
      return upload.autofillStage
        ? AUTOFILL_STAGE_LABELS[upload.autofillStage]
        : null;
    case "buffer":
      return upload.bufferStage
        ? BUFFER_STAGE_LABELS[upload.bufferStage]
        : null;
    case "render-vertical":
      return upload.renderVerticalStage
        ? RENDER_VERTICAL_STAGE_LABELS[upload.renderVerticalStage]
        : null;
    case "duplicate-course":
      return upload.duplicateCourseStage
        ? DUPLICATE_COURSE_STAGE_LABELS[upload.duplicateCourseStage]
        : null;
    case "storage-move":
      return upload.cancelRequested
        ? "Cancelling: removing partial copies"
        : upload.storageMoveStage
          ? STORAGE_MOVE_STAGE_LABELS[upload.storageMoveStage]
          : null;
    case "storage-delete":
      return upload.cancelRequested
        ? "Cancelling: stopping before the next file"
        : upload.storageDeleteStage
          ? STORAGE_DELETE_STAGE_LABELS[upload.storageDeleteStage]
          : null;
    // A plain upload has no stages: its bar streams a byte percentage.
    case "youtube":
    case "youtube-shorts":
    case "ai-hero":
    case "skills-changelog":
      return null;
  }
}
