export namespace uploadReducer {
  export type UploadStatus = "uploading" | "retrying" | "success" | "error";
  export type UploadType = "youtube" | "buffer" | "ai-hero" | "export";
  export type BufferStage = "copying" | "syncing" | "sending-webhook";
  export type ExportStage = "concatenating-clips" | "normalizing-audio";

  interface BaseUploadEntry {
    uploadId: string;
    videoId: string;
    title: string;
    progress: number;
    status: UploadStatus;
    errorMessage: string | null;
    retryCount: number;
  }

  export interface YouTubeUploadEntry extends BaseUploadEntry {
    uploadType: "youtube";
    youtubeVideoId: string | null;
  }

  export interface BufferUploadEntry extends BaseUploadEntry {
    uploadType: "buffer";
    bufferStage: BufferStage | null;
  }

  export interface AiHeroUploadEntry extends BaseUploadEntry {
    uploadType: "ai-hero";
    aiHeroSlug: string | null;
  }

  export interface ExportUploadEntry extends BaseUploadEntry {
    uploadType: "export";
    exportStage: ExportStage | null;
  }

  export type UploadEntry =
    | YouTubeUploadEntry
    | BufferUploadEntry
    | AiHeroUploadEntry
    | ExportUploadEntry;

  export interface State {
    uploads: Record<string, UploadEntry>;
  }

  export type Action =
    | {
        type: "START_UPLOAD";
        uploadId: string;
        videoId: string;
        title: string;
        uploadType?: UploadType;
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
        type: "UPLOAD_SUCCESS";
        uploadId: string;
        youtubeVideoId?: string;
        aiHeroSlug?: string;
      }
    | { type: "UPLOAD_ERROR"; uploadId: string; errorMessage: string }
    | { type: "RETRY"; uploadId: string }
    | { type: "DISMISS"; uploadId: string };
}

export const createInitialUploadState = (): uploadReducer.State => ({
  uploads: {},
});

export const uploadReducer = (
  state: uploadReducer.State,
  action: uploadReducer.Action
): uploadReducer.State => {
  switch (action.type) {
    case "START_UPLOAD": {
      const uploadType = action.uploadType ?? "youtube";
      const base = {
        uploadId: action.uploadId,
        videoId: action.videoId,
        title: action.title,
        progress: 0,
        status: "uploading" as const,
        errorMessage: null,
        retryCount: 0,
      };

      let entry: uploadReducer.UploadEntry;
      switch (uploadType) {
        case "buffer":
          entry = { ...base, uploadType: "buffer", bufferStage: "copying" };
          break;
        case "ai-hero":
          entry = { ...base, uploadType: "ai-hero", aiHeroSlug: null };
          break;
        case "export":
          entry = {
            ...base,
            uploadType: "export",
            exportStage: "concatenating-clips",
          };
          break;
        default:
          entry = { ...base, uploadType: "youtube", youtubeVideoId: null };
          break;
      }

      return {
        ...state,
        uploads: {
          ...state.uploads,
          [action.uploadId]: entry,
        },
      };
    }

    case "UPDATE_PROGRESS": {
      const upload = state.uploads[action.uploadId];
      if (!upload) return state;

      return {
        ...state,
        uploads: {
          ...state.uploads,
          [action.uploadId]: {
            ...upload,
            progress: action.progress,
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
          },
        },
      };
    }

    case "UPLOAD_SUCCESS": {
      const upload = state.uploads[action.uploadId];
      if (!upload) return state;

      const base = {
        ...upload,
        status: "success" as const,
        progress: 100,
        errorMessage: null,
      };

      let entry: uploadReducer.UploadEntry;
      switch (upload.uploadType) {
        case "youtube":
          entry = {
            ...base,
            uploadType: "youtube",
            youtubeVideoId: action.youtubeVideoId ?? null,
          };
          break;
        case "buffer":
          entry = { ...base, uploadType: "buffer", bufferStage: null };
          break;
        case "ai-hero":
          entry = {
            ...base,
            uploadType: "ai-hero",
            aiHeroSlug: action.aiHeroSlug ?? null,
          };
          break;
        case "export":
          entry = { ...base, uploadType: "export", exportStage: null };
          break;
      }

      return {
        ...state,
        uploads: {
          ...state.uploads,
          [action.uploadId]: entry,
        },
      };
    }

    case "UPLOAD_ERROR": {
      const upload = state.uploads[action.uploadId];
      if (!upload) return state;

      const nextRetryCount = upload.retryCount + 1;

      if (nextRetryCount < 3) {
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

      return {
        ...state,
        uploads: {
          ...state.uploads,
          [action.uploadId]: {
            ...upload,
            status: "error",
            retryCount: nextRetryCount,
            errorMessage: action.errorMessage,
          },
        },
      };
    }

    case "RETRY": {
      const upload = state.uploads[action.uploadId];
      if (!upload) return state;

      const base = {
        uploadId: upload.uploadId,
        videoId: upload.videoId,
        title: upload.title,
        progress: 0,
        status: "uploading" as const,
        errorMessage: upload.errorMessage,
        retryCount: upload.retryCount,
      };

      let entry: uploadReducer.UploadEntry;
      switch (upload.uploadType) {
        case "buffer":
          entry = { ...base, uploadType: "buffer", bufferStage: "copying" };
          break;
        case "ai-hero":
          entry = { ...base, uploadType: "ai-hero", aiHeroSlug: null };
          break;
        case "export":
          entry = {
            ...base,
            uploadType: "export",
            exportStage: "concatenating-clips",
          };
          break;
        default:
          entry = {
            ...base,
            uploadType: "youtube",
            youtubeVideoId: upload.youtubeVideoId,
          };
          break;
      }

      return {
        ...state,
        uploads: {
          ...state.uploads,
          [action.uploadId]: entry,
        },
      };
    }

    case "DISMISS": {
      const { [action.uploadId]: _, ...remaining } = state.uploads;
      return {
        ...state,
        uploads: remaining,
      };
    }

    default:
      return state;
  }
};
