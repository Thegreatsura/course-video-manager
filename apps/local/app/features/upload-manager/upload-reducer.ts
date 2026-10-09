import type * as Entry from "./upload-entry";
import { uploadTypeRegistry } from "./upload-type-registry";
import {
  AUTOFILL_STAGE_BANDS,
  BUFFER_STAGE_BANDS,
  PUBLISH_STAGE_BANDS,
  PUBLISH_VIDEO_UPLOAD_BANDS,
  RENDER_VERTICAL_STAGE_BANDS,
  exportStageBands,
  fillBand,
  isSettled,
  streamedProgressBand,
  withDerivedParentProgress,
} from "./upload-progress";
import { trackTimings, type UploadTiming } from "./upload-timing";

export namespace uploadReducer {
  export type UploadStatus = Entry.UploadStatus;
  export type UploadType = Entry.UploadType;
  export type BufferStage = Entry.BufferStage;
  export type ExportStage = Entry.ExportStage;
  export type RenderVerticalStage = Entry.RenderVerticalStage;
  export type PublishStage = Entry.PublishStage;
  export type AutofillStage = Entry.AutofillStage;
  export type VideoUploadStage = Entry.VideoUploadStage;
  export type BaseUploadEntry = Entry.BaseUploadEntry;
  export type YouTubeUploadEntry = Entry.YouTubeUploadEntry;
  export type YouTubeShortsUploadEntry = Entry.YouTubeShortsUploadEntry;
  export type BufferUploadEntry = Entry.BufferUploadEntry;
  export type AiHeroUploadEntry = Entry.AiHeroUploadEntry;
  export type SkillsChangelogUploadEntry = Entry.SkillsChangelogUploadEntry;
  export type ExportUploadEntry = Entry.ExportUploadEntry;
  export type PublishUploadEntry = Entry.PublishUploadEntry;
  export type AutofillUploadEntry = Entry.AutofillUploadEntry;
  export type RenderVerticalUploadEntry = Entry.RenderVerticalUploadEntry;
  export type UploadEntry = Entry.UploadEntry;

  export interface State {
    uploads: Record<string, UploadEntry>;
    /** When each job's stages started and how its bar has moved: the ETA's input. */
    timings: Record<string, UploadTiming>;
  }

  /** `at`: the provider's clock reading, so the reducer never reads one. */
  export type Action = ActionBody & { at?: number };

  type ActionBody =
    | {
        type: "START_UPLOAD";
        uploadId: string;
        videoId: string;
        title: string;
        uploadType?: UploadType;
        dependsOn?: string;
        isBatchEntry?: boolean;
        courseId?: string;
        parentUploadId?: string;
      }
    | { type: "UPDATE_PROGRESS"; uploadId: string; progress: number }
    | {
        type: "UPDATE_BUFFER_STAGE";
        uploadId: string;
        stage: BufferStage;
      }
    | {
        type: "UPDATE_EXPORT_STAGE";
        uploadId: string;
        stage: ExportStage;
      }
    | {
        // Real ffmpeg progress within an export stage (integer 0–99, resets
        // per stage) — banded into the single bar: concatenating 0–80,
        // normalizing 80–99.
        type: "UPDATE_EXPORT_PROGRESS";
        uploadId: string;
        stage: Exclude<ExportStage, "queued">;
        percent: number;
      }
    | {
        type: "UPLOAD_SUCCESS";
        uploadId: string;
        youtubeVideoId?: string;
        aiHeroSlug?: string;
        skillsChangelogSlug?: string;
      }
    | { type: "UPLOAD_ERROR"; uploadId: string; errorMessage: string }
    | { type: "UPLOAD_FATAL_ERROR"; uploadId: string; errorMessage: string }
    | { type: "RETRY"; uploadId: string }
    /**
     * A background Job this tab follows (`features/jobs/`) settled. An upload
     * waiting on it (`dependsOn` is the Job's id: "export, then post")
     * starts, or fails as it would have behind a failed upload.
     */
    | { type: "server-job-succeeded"; jobId: string }
    | { type: "server-job-failed"; jobId: string; title: string }
    | { type: "DISMISS"; uploadId: string }
    /** "Clear finished": every settled top-level row goes, with its children. */
    | { type: "press-clear-finished" }
    | {
        type: "UPDATE_PUBLISH_STAGE";
        uploadId: string;
        stage: PublishStage;
      }
    | {
        type: "PUBLISH_COMPLETE";
        uploadId: string;
        newDraftVersionId: string;
      }
    | {
        type: "UPDATE_AUTOFILL_STAGE";
        uploadId: string;
        stage: AutofillStage;
      }
    | {
        type: "UPDATE_RENDER_VERTICAL_STAGE";
        uploadId: string;
        stage: RenderVerticalStage;
      }
    | {
        type: "UPDATE_VIDEO_UPLOAD_STAGE";
        uploadId: string;
        stage: VideoUploadStage;
      }
    | {
        // Bytes moving for one Video inside a Publish. `totalBytes` is its
        // size on disk and arrives with the first event, before any byte has
        // gone past.
        type: "UPDATE_VIDEO_UPLOAD_PROGRESS";
        uploadId: string;
        uploadedBytes: number;
        totalBytes: number;
      };
}

/**
 * The rows `rootIds`, each with its whole subtree. Children are only ever
 * rendered nested under their parent, so leaving them behind would strand
 * them in the list with nothing to belong to.
 */
const withoutSubtrees = (
  state: uploadReducer.State,
  rootIds: readonly string[]
): uploadReducer.State => {
  const dismissed = new Set(rootIds);
  let grew = true;
  while (grew) {
    grew = false;
    for (const upload of Object.values(state.uploads)) {
      if (dismissed.has(upload.uploadId)) continue;
      if (!upload.parentUploadId) continue;
      if (!dismissed.has(upload.parentUploadId)) continue;
      dismissed.add(upload.uploadId);
      grew = true;
    }
  }
  return {
    ...state,
    uploads: Object.fromEntries(
      Object.entries(state.uploads).filter(([id]) => !dismissed.has(id))
    ),
  };
};

export const createInitialUploadState = (): uploadReducer.State => ({
  uploads: {},
  timings: {},
});

export const uploadReducer = (
  state: uploadReducer.State,
  action: uploadReducer.Action
): uploadReducer.State => {
  const next = reduceUploads(state, action);
  if (next === state) return state;
  const uploads = withDerivedParentProgress(next.uploads);
  return { ...next, uploads, timings: trackTimings(state, uploads, action) };
};

const reduceUploads = (
  state: uploadReducer.State,
  action: uploadReducer.Action
): uploadReducer.State => {
  switch (action.type) {
    case "START_UPLOAD": {
      const uploadType = action.uploadType ?? "youtube";
      const dependsOn = action.dependsOn ?? null;
      const status = dependsOn ? ("waiting" as const) : ("uploading" as const);
      const base: uploadReducer.BaseUploadEntry = {
        uploadId: action.uploadId,
        videoId: action.videoId,
        title: action.title,
        progress: 0,
        status,
        errorMessage: null,
        retryCount: 0,
        terminal: false,
        dependsOn,
        parentUploadId: action.parentUploadId ?? null,
      };

      return {
        ...state,
        uploads: {
          ...state.uploads,
          [action.uploadId]: uploadTypeRegistry[uploadType].createEntry(
            base,
            action
          ),
        },
      };
    }

    case "UPDATE_PROGRESS": {
      const upload = state.uploads[action.uploadId];
      if (!upload) return state;
      // A Publish's bar is the aggregate of its per-Video children, so no
      // number streamed at the job as a whole may move it.
      if (upload.uploadType === "publish") return state;

      const band = streamedProgressBand(upload);

      return {
        ...state,
        uploads: {
          ...state.uploads,
          [action.uploadId]: {
            ...upload,
            // Monotonic, like UPDATE_EXPORT_PROGRESS: a stage that streams a
            // real percentage fills its own band, so finishing one stage can
            // never drag the bar back below where the next stage starts.
            progress: Math.max(
              upload.progress,
              band ? fillBand(band, action.progress) : action.progress
            ),
          },
        },
      };
    }

    case "UPDATE_BUFFER_STAGE": {
      const upload = state.uploads[action.uploadId];
      if (!upload || upload.uploadType !== "buffer") return state;

      return {
        ...state,
        uploads: {
          ...state.uploads,
          [action.uploadId]: {
            ...upload,
            bufferStage: action.stage,
            progress: Math.max(
              upload.progress,
              BUFFER_STAGE_BANDS[action.stage].start
            ),
          },
        },
      };
    }

    case "UPDATE_EXPORT_STAGE": {
      const upload = state.uploads[action.uploadId];
      if (!upload || upload.uploadType !== "export") return state;

      return {
        ...state,
        uploads: {
          ...state.uploads,
          [action.uploadId]: {
            ...upload,
            exportStage: action.stage,
            progress: Math.max(
              upload.progress,
              exportStageBands(upload)[action.stage].start
            ),
          },
        },
      };
    }

    case "UPDATE_EXPORT_PROGRESS": {
      const upload = state.uploads[action.uploadId];
      if (!upload || upload.uploadType !== "export") return state;

      const banded = fillBand(
        exportStageBands(upload)[action.stage],
        action.percent
      );

      return {
        ...state,
        uploads: {
          ...state.uploads,
          [action.uploadId]: {
            ...upload,
            exportStage: action.stage,
            // Monotonic: a late event from the previous phase never drags the
            // bar backwards.
            progress: Math.max(upload.progress, banded),
          },
        },
      };
    }

    case "UPDATE_VIDEO_UPLOAD_STAGE": {
      const upload = state.uploads[action.uploadId];
      if (!upload || upload.uploadType !== "export") return state;
      // The Dropbox commit is retried once server-side, which replays these
      // events for Videos that already landed. A settled task stays settled.
      if (isSettled(upload)) return state;

      return {
        ...state,
        uploads: {
          ...state.uploads,
          [action.uploadId]: {
            ...upload,
            // The encode is over — whatever stage it was left mid-way through
            // no longer describes this Video.
            exportStage: null,
            videoUploadStage: action.stage,
            progress: Math.max(
              upload.progress,
              PUBLISH_VIDEO_UPLOAD_BANDS[action.stage].start
            ),
          },
        },
      };
    }

    case "UPDATE_VIDEO_UPLOAD_PROGRESS": {
      const upload = state.uploads[action.uploadId];
      if (!upload || upload.uploadType !== "export") return state;
      if (isSettled(upload)) return state;

      const percent =
        action.totalBytes > 0
          ? (action.uploadedBytes / action.totalBytes) * 100
          : 0;

      return {
        ...state,
        uploads: {
          ...state.uploads,
          [action.uploadId]: {
            ...upload,
            exportStage: null,
            videoUploadStage: "uploading",
            uploadedBytes: action.uploadedBytes,
            totalBytes: action.totalBytes,
            progress: Math.max(
              upload.progress,
              fillBand(PUBLISH_VIDEO_UPLOAD_BANDS.uploading, percent)
            ),
          },
        },
      };
    }

    case "UPDATE_PUBLISH_STAGE": {
      const upload = state.uploads[action.uploadId];
      if (!upload || upload.uploadType !== "publish") return state;

      return {
        ...state,
        uploads: {
          ...state.uploads,
          [action.uploadId]: {
            ...upload,
            publishStage: action.stage,
            progress: Math.max(
              upload.progress,
              PUBLISH_STAGE_BANDS[action.stage].start
            ),
          },
        },
      };
    }

    case "PUBLISH_COMPLETE": {
      const upload = state.uploads[action.uploadId];
      if (!upload || upload.uploadType !== "publish") return state;

      return {
        ...state,
        uploads: {
          ...state.uploads,
          [action.uploadId]: {
            ...upload,
            newDraftVersionId: action.newDraftVersionId,
          },
        },
      };
    }

    case "UPDATE_AUTOFILL_STAGE": {
      const upload = state.uploads[action.uploadId];
      if (!upload || upload.uploadType !== "autofill") return state;
      // A settled row stays settled: a late stage event must not reopen a
      // Video that already failed or landed.
      if (isSettled(upload)) return state;

      return {
        ...state,
        uploads: {
          ...state.uploads,
          [action.uploadId]: {
            ...upload,
            autofillStage: action.stage,
            progress: Math.max(
              upload.progress,
              AUTOFILL_STAGE_BANDS[action.stage].start
            ),
          },
        },
      };
    }

    case "UPDATE_RENDER_VERTICAL_STAGE": {
      const upload = state.uploads[action.uploadId];
      if (!upload || upload.uploadType !== "render-vertical") return state;

      return {
        ...state,
        uploads: {
          ...state.uploads,
          [action.uploadId]: {
            ...upload,
            renderVerticalStage: action.stage,
            progress: Math.max(
              upload.progress,
              RENDER_VERTICAL_STAGE_BANDS[action.stage].start
            ),
          },
        },
      };
    }

    case "UPLOAD_SUCCESS": {
      const upload = state.uploads[action.uploadId];
      if (!upload) return state;

      const entry: uploadReducer.UploadEntry = uploadTypeRegistry[
        upload.uploadType
      ].applySuccess(upload, action);

      // Activate any jobs waiting on this upload
      const updatedUploads = { ...state.uploads, [action.uploadId]: entry };
      for (const [id, u] of Object.entries(updatedUploads)) {
        if (u.dependsOn === action.uploadId && u.status === "waiting") {
          updatedUploads[id] = { ...u, status: "uploading" };
        }
      }

      return {
        ...state,
        uploads: updatedUploads,
      };
    }

    case "UPLOAD_FATAL_ERROR": {
      const upload = state.uploads[action.uploadId];
      if (!upload) return state;

      const updatedUploads = {
        ...state.uploads,
        [action.uploadId]: {
          ...upload,
          status: "error" as const,
          terminal: true,
          errorMessage: action.errorMessage,
        },
      };
      for (const [id, candidate] of Object.entries(updatedUploads)) {
        if (
          candidate.dependsOn === action.uploadId &&
          candidate.status === "waiting"
        ) {
          updatedUploads[id] = {
            ...candidate,
            status: "error" as const,
            errorMessage: `Dependency "${upload.title}" failed`,
          };
        }
      }
      return { ...state, uploads: updatedUploads };
    }

    case "UPLOAD_ERROR": {
      const upload = state.uploads[action.uploadId];
      if (!upload) return state;

      const nextRetryCount = upload.retryCount + 1;

      if (nextRetryCount < 3 && !upload.terminal) {
        return {
          ...state,
          uploads: {
            ...state.uploads,
            [action.uploadId]: {
              ...upload,
              status: "retrying",
              retryCount: nextRetryCount,
              errorMessage: action.errorMessage,
            },
          },
        };
      }

      // Final failure — also fail any jobs waiting on this upload
      const updatedUploads = {
        ...state.uploads,
        [action.uploadId]: {
          ...upload,
          status: "error" as const,
          retryCount: nextRetryCount,
          errorMessage: action.errorMessage,
        },
      };
      for (const [id, u] of Object.entries(updatedUploads)) {
        if (u.dependsOn === action.uploadId && u.status === "waiting") {
          updatedUploads[id] = {
            ...u,
            status: "error" as const,
            errorMessage: `Dependency "${upload.title}" failed`,
          };
        }
      }

      return {
        ...state,
        uploads: updatedUploads,
      };
    }

    case "server-job-succeeded": {
      let changed = false;
      const uploads = { ...state.uploads };
      for (const [id, u] of Object.entries(uploads)) {
        if (u.dependsOn === action.jobId && u.status === "waiting") {
          uploads[id] = { ...u, status: "uploading" };
          changed = true;
        }
      }
      return changed ? { ...state, uploads } : state;
    }

    case "server-job-failed": {
      let changed = false;
      const uploads = { ...state.uploads };
      for (const [id, u] of Object.entries(uploads)) {
        if (u.dependsOn === action.jobId && u.status === "waiting") {
          uploads[id] = {
            ...u,
            status: "error" as const,
            errorMessage: `Dependency "${action.title}" failed`,
          };
          changed = true;
        }
      }
      return changed ? { ...state, uploads } : state;
    }

    case "RETRY": {
      const upload = state.uploads[action.uploadId];
      if (!upload) return state;

      const base: uploadReducer.BaseUploadEntry = {
        uploadId: upload.uploadId,
        videoId: upload.videoId,
        title: upload.title,
        progress: 0,
        status: "uploading" as const,
        errorMessage: upload.errorMessage,
        retryCount: upload.retryCount,
        terminal: upload.terminal,
        dependsOn: upload.dependsOn,
        parentUploadId: upload.parentUploadId,
      };

      return {
        ...state,
        uploads: {
          ...state.uploads,
          [action.uploadId]: uploadTypeRegistry[upload.uploadType].resetEntry(
            base,
            upload
          ),
        },
      };
    }

    case "DISMISS": {
      if (!state.uploads[action.uploadId]) return state;
      return withoutSubtrees(state, [action.uploadId]);
    }

    case "press-clear-finished": {
      const settled = Object.values(state.uploads)
        .filter(
          (u) =>
            !u.parentUploadId &&
            (u.status === "success" || u.status === "error")
        )
        .map((u) => u.uploadId);
      if (settled.length === 0) return state;
      return withoutSubtrees(state, settled);
    }

    default:
      return state;
  }
};
