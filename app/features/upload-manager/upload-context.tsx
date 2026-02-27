import {
  createContext,
  useCallback,
  useEffect,
  useReducer,
  useRef,
} from "react";
import { toast } from "sonner";
import { uploadReducer, createInitialUploadState } from "./upload-reducer";
import { startSSEUpload } from "./sse-upload-client";
import { startSSESocialPost } from "./sse-social-client";
import { startSSEAiHeroPost } from "./sse-ai-hero-client";
import { startSSEExport } from "./sse-export-client";

export interface UploadContextType {
  uploads: uploadReducer.State["uploads"];
  startUpload: (
    videoId: string,
    title: string,
    description: string,
    privacyStatus: "public" | "unlisted"
  ) => string;
  startSocialUpload: (
    videoId: string,
    title: string,
    caption: string
  ) => string;
  startAiHeroUpload: (
    videoId: string,
    title: string,
    body: string,
    description: string,
    slug: string
  ) => string;
  startExportUpload: (videoId: string, title: string) => string;
  dismissUpload: (uploadId: string) => void;
}

export const UploadContext = createContext<UploadContextType>(null!);

let nextUploadId = 0;
const generateUploadId = () => `upload-${++nextUploadId}`;

export function UploadProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(
    uploadReducer,
    undefined,
    createInitialUploadState
  );

  const abortControllersRef = useRef<Map<string, AbortController>>(new Map());
  const previousUploadsRef = useRef<uploadReducer.State["uploads"]>({});

  // Stores description + privacyStatus for YouTube retries
  const uploadParamsRef = useRef<
    Map<string, { description: string; privacyStatus: "public" | "unlisted" }>
  >(new Map());

  // Stores caption for Buffer retries
  const socialParamsRef = useRef<Map<string, { caption: string }>>(new Map());

  // Stores body + description + slug for AI Hero retries
  const aiHeroParamsRef = useRef<
    Map<string, { body: string; description: string; slug: string }>
  >(new Map());

  const initiateSSEConnection = useCallback(
    (
      uploadId: string,
      videoId: string,
      title: string,
      description: string,
      privacyStatus: "public" | "unlisted"
    ) => {
      const existing = abortControllersRef.current.get(uploadId);
      if (existing) {
        existing.abort();
      }

      const abortController = startSSEUpload(
        { videoId, title, description, privacyStatus },
        {
          onProgress: (percentage) => {
            dispatch({
              type: "UPDATE_PROGRESS",
              uploadId,
              progress: percentage,
            });
          },
          onComplete: (youtubeVideoId) => {
            dispatch({
              type: "UPLOAD_SUCCESS",
              uploadId,
              youtubeVideoId,
            });
            abortControllersRef.current.delete(uploadId);
          },
          onError: (message) => {
            dispatch({
              type: "UPLOAD_ERROR",
              uploadId,
              errorMessage: message,
            });
            abortControllersRef.current.delete(uploadId);
          },
        }
      );

      abortControllersRef.current.set(uploadId, abortController);
    },
    []
  );

  const initiateSSESocialConnection = useCallback(
    (uploadId: string, videoId: string, caption: string) => {
      const existing = abortControllersRef.current.get(uploadId);
      if (existing) {
        existing.abort();
      }

      const abortController = startSSESocialPost(
        { videoId, caption },
        {
          onProgress: (percentage) => {
            dispatch({
              type: "UPDATE_PROGRESS",
              uploadId,
              progress: percentage,
            });
          },
          onStageChange: (stage) => {
            dispatch({
              type: "UPDATE_BUFFER_STAGE",
              uploadId,
              stage,
            });
          },
          onComplete: () => {
            dispatch({
              type: "UPLOAD_SUCCESS",
              uploadId,
            });
            abortControllersRef.current.delete(uploadId);
          },
          onError: (message) => {
            dispatch({
              type: "UPLOAD_ERROR",
              uploadId,
              errorMessage: message,
            });
            abortControllersRef.current.delete(uploadId);
          },
        }
      );

      abortControllersRef.current.set(uploadId, abortController);
    },
    []
  );

  const initiateSSEAiHeroConnection = useCallback(
    (
      uploadId: string,
      videoId: string,
      title: string,
      body: string,
      description: string,
      slug: string
    ) => {
      const existing = abortControllersRef.current.get(uploadId);
      if (existing) {
        existing.abort();
      }

      const abortController = startSSEAiHeroPost(
        { videoId, title, body, description, slug },
        {
          onProgress: (percentage) => {
            dispatch({
              type: "UPDATE_PROGRESS",
              uploadId,
              progress: percentage,
            });
          },
          onComplete: (aiHeroSlug) => {
            dispatch({
              type: "UPLOAD_SUCCESS",
              uploadId,
              aiHeroSlug,
            });
            abortControllersRef.current.delete(uploadId);
          },
          onError: (message) => {
            dispatch({
              type: "UPLOAD_ERROR",
              uploadId,
              errorMessage: message,
            });
            abortControllersRef.current.delete(uploadId);
          },
        }
      );

      abortControllersRef.current.set(uploadId, abortController);
    },
    []
  );

  const initiateSSEExportConnection = useCallback(
    (uploadId: string, videoId: string) => {
      const existing = abortControllersRef.current.get(uploadId);
      if (existing) {
        existing.abort();
      }

      const abortController = startSSEExport(
        { videoId },
        {
          onStageChange: (stage) => {
            dispatch({
              type: "UPDATE_EXPORT_STAGE",
              uploadId,
              stage,
            });
          },
          onComplete: () => {
            dispatch({
              type: "UPLOAD_SUCCESS",
              uploadId,
            });
            abortControllersRef.current.delete(uploadId);
          },
          onError: (message) => {
            dispatch({
              type: "UPLOAD_ERROR",
              uploadId,
              errorMessage: message,
            });
            abortControllersRef.current.delete(uploadId);
          },
        }
      );

      abortControllersRef.current.set(uploadId, abortController);
    },
    []
  );

  const startUpload = useCallback(
    (
      videoId: string,
      title: string,
      description: string,
      privacyStatus: "public" | "unlisted"
    ) => {
      const uploadId = generateUploadId();

      uploadParamsRef.current.set(uploadId, { description, privacyStatus });

      dispatch({
        type: "START_UPLOAD",
        uploadId,
        videoId,
        title,
      });

      initiateSSEConnection(
        uploadId,
        videoId,
        title,
        description,
        privacyStatus
      );

      return uploadId;
    },
    [initiateSSEConnection]
  );

  const startSocialUpload = useCallback(
    (videoId: string, title: string, caption: string) => {
      const uploadId = generateUploadId();

      socialParamsRef.current.set(uploadId, { caption });

      dispatch({
        type: "START_UPLOAD",
        uploadId,
        videoId,
        title,
        uploadType: "buffer",
      });

      initiateSSESocialConnection(uploadId, videoId, caption);

      return uploadId;
    },
    [initiateSSESocialConnection]
  );

  const startAiHeroUpload = useCallback(
    (
      videoId: string,
      title: string,
      body: string,
      description: string,
      slug: string
    ) => {
      const uploadId = generateUploadId();

      aiHeroParamsRef.current.set(uploadId, { body, description, slug });

      dispatch({
        type: "START_UPLOAD",
        uploadId,
        videoId,
        title,
        uploadType: "ai-hero",
      });

      initiateSSEAiHeroConnection(
        uploadId,
        videoId,
        title,
        body,
        description,
        slug
      );

      return uploadId;
    },
    [initiateSSEAiHeroConnection]
  );

  const startExportUpload = useCallback(
    (videoId: string, title: string) => {
      const uploadId = generateUploadId();

      dispatch({
        type: "START_UPLOAD",
        uploadId,
        videoId,
        title,
        uploadType: "export",
      });

      initiateSSEExportConnection(uploadId, videoId);

      return uploadId;
    },
    [initiateSSEExportConnection]
  );

  const dismissUpload = useCallback((uploadId: string) => {
    const abortController = abortControllersRef.current.get(uploadId);
    if (abortController) {
      abortController.abort();
      abortControllersRef.current.delete(uploadId);
    }
    uploadParamsRef.current.delete(uploadId);
    socialParamsRef.current.delete(uploadId);
    aiHeroParamsRef.current.delete(uploadId);
    dispatch({ type: "DISMISS", uploadId });
  }, []);

  // Single effect: watch for status transitions to fire toasts and handle auto-retry
  useEffect(() => {
    const prev = previousUploadsRef.current;
    const current = state.uploads;

    for (const [uploadId, upload] of Object.entries(current)) {
      const prevUpload = prev[uploadId];
      if (!prevUpload) continue;
      if (prevUpload.status === upload.status) continue;

      if (upload.status === "success") {
        if (upload.uploadType === "buffer") {
          const postUrl = `/videos/${upload.videoId}/post`;

          toast.success(`"${upload.title}" sent to Buffer`, {
            duration: Infinity,
            cancel: {
              label: "Go to Post",
              onClick: () => {
                window.location.href = postUrl;
              },
            },
          });
        } else if (upload.uploadType === "youtube") {
          const youtubeStudioUrl = `https://studio.youtube.com/video/${upload.youtubeVideoId}/edit`;
          const postUrl = `/videos/${upload.videoId}/post`;

          toast.success(`"${upload.title}" uploaded to YouTube`, {
            duration: Infinity,
            action: {
              label: "YouTube Studio",
              onClick: () => window.open(youtubeStudioUrl, "_blank"),
            },
            cancel: {
              label: "Go to Post",
              onClick: () => {
                window.location.href = postUrl;
              },
            },
          });
        } else if (upload.uploadType === "ai-hero") {
          const aiHeroPageUrl = `/videos/${upload.videoId}/ai-hero`;

          toast.success(`"${upload.title}" posted to AI Hero`, {
            duration: Infinity,
            cancel: {
              label: "Go to AI Hero",
              onClick: () => {
                window.location.href = aiHeroPageUrl;
              },
            },
          });

          // Fire-and-forget: add AI Hero post URL to global links
          if (upload.aiHeroSlug) {
            const formData = new FormData();
            formData.append("title", upload.title);
            formData.append("url", `https://aihero.dev/${upload.aiHeroSlug}`);
            fetch("/api/links", {
              method: "POST",
              body: formData,
            }).catch(() => {
              // Silently ignore errors (including duplicate URL conflicts)
            });
          }
        } else if (upload.uploadType === "export") {
          toast.success(`"${upload.title}" exported successfully`);
        }
      }

      if (upload.status === "error") {
        const postUrl = `/videos/${upload.videoId}/post`;

        toast.error(`"${upload.title}" upload failed: ${upload.errorMessage}`, {
          duration: Infinity,
          cancel: {
            label: "Go to Post",
            onClick: () => {
              window.location.href = postUrl;
            },
          },
        });
      }

      if (upload.status === "retrying") {
        dispatch({ type: "RETRY", uploadId });

        if (upload.uploadType === "buffer") {
          const params = socialParamsRef.current.get(uploadId);
          if (params) {
            initiateSSESocialConnection(
              uploadId,
              upload.videoId,
              params.caption
            );
          }
        } else if (upload.uploadType === "youtube") {
          const params = uploadParamsRef.current.get(uploadId);
          if (params) {
            initiateSSEConnection(
              uploadId,
              upload.videoId,
              upload.title,
              params.description,
              params.privacyStatus
            );
          }
        } else if (upload.uploadType === "ai-hero") {
          const params = aiHeroParamsRef.current.get(uploadId);
          if (params) {
            initiateSSEAiHeroConnection(
              uploadId,
              upload.videoId,
              upload.title,
              params.body,
              params.description,
              params.slug
            );
          }
        } else if (upload.uploadType === "export") {
          initiateSSEExportConnection(uploadId, upload.videoId);
        }
      }
    }

    previousUploadsRef.current = current;
  }, [
    state.uploads,
    initiateSSEConnection,
    initiateSSESocialConnection,
    initiateSSEAiHeroConnection,
    initiateSSEExportConnection,
  ]);

  // Clean up abort controllers on unmount
  useEffect(() => {
    return () => {
      for (const controller of abortControllersRef.current.values()) {
        controller.abort();
      }
    };
  }, []);

  return (
    <UploadContext.Provider
      value={{
        uploads: state.uploads,
        startUpload,
        startSocialUpload,
        startAiHeroUpload,
        startExportUpload,
        dismissUpload,
      }}
    >
      {children}
    </UploadContext.Provider>
  );
}
