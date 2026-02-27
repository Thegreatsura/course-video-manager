import { describe, expect, it } from "vitest";
import { uploadReducer, createInitialUploadState } from "./upload-reducer";

const reduce = (state: uploadReducer.State, action: uploadReducer.Action) =>
  uploadReducer(state, action);

const createState = (
  overrides: Partial<uploadReducer.State> = {}
): uploadReducer.State => ({
  ...createInitialUploadState(),
  ...overrides,
});

const createYouTubeEntry = (
  overrides: Partial<Omit<uploadReducer.YouTubeUploadEntry, "uploadType">> = {}
): uploadReducer.YouTubeUploadEntry => ({
  uploadId: "upload-1",
  videoId: "video-1",
  title: "Test Video",
  progress: 0,
  status: "uploading",
  uploadType: "youtube",
  youtubeVideoId: null,
  errorMessage: null,
  retryCount: 0,
  ...overrides,
});

const createBufferEntry = (
  overrides: Partial<Omit<uploadReducer.BufferUploadEntry, "uploadType">> = {}
): uploadReducer.BufferUploadEntry => ({
  uploadId: "upload-1",
  videoId: "video-1",
  title: "Test Video",
  progress: 0,
  status: "uploading",
  uploadType: "buffer",
  bufferStage: "copying",
  errorMessage: null,
  retryCount: 0,
  ...overrides,
});

const createAiHeroEntry = (
  overrides: Partial<Omit<uploadReducer.AiHeroUploadEntry, "uploadType">> = {}
): uploadReducer.AiHeroUploadEntry => ({
  uploadId: "upload-1",
  videoId: "video-1",
  title: "Test Video",
  progress: 0,
  status: "uploading",
  uploadType: "ai-hero",
  aiHeroSlug: null,
  errorMessage: null,
  retryCount: 0,
  ...overrides,
});

const createExportEntry = (
  overrides: Partial<Omit<uploadReducer.ExportUploadEntry, "uploadType">> = {}
): uploadReducer.ExportUploadEntry => ({
  uploadId: "upload-1",
  videoId: "video-1",
  title: "Test Video",
  progress: 0,
  status: "uploading",
  uploadType: "export",
  exportStage: "concatenating-clips",
  errorMessage: null,
  retryCount: 0,
  ...overrides,
});

describe("uploadReducer", () => {
  describe("START_UPLOAD", () => {
    it("should add a new youtube upload entry", () => {
      const state = reduce(createState(), {
        type: "START_UPLOAD",
        uploadId: "upload-1",
        videoId: "video-1",
        title: "My Video",
      });

      expect(state.uploads["upload-1"]).toEqual({
        uploadId: "upload-1",
        videoId: "video-1",
        title: "My Video",
        progress: 0,
        status: "uploading",
        uploadType: "youtube",
        youtubeVideoId: null,
        errorMessage: null,
        retryCount: 0,
      });
    });

    it("should not affect existing uploads", () => {
      const existing = createYouTubeEntry({
        uploadId: "upload-1",
        progress: 50,
      });
      const state = reduce(createState({ uploads: { "upload-1": existing } }), {
        type: "START_UPLOAD",
        uploadId: "upload-2",
        videoId: "video-2",
        title: "Second Video",
      });

      expect(state.uploads["upload-1"]).toEqual(existing);
      expect(state.uploads["upload-2"]).toBeDefined();
    });

    it("should overwrite if same uploadId is started again", () => {
      const existing = createYouTubeEntry({
        uploadId: "upload-1",
        progress: 50,
        status: "error",
        retryCount: 3,
      });
      const state = reduce(createState({ uploads: { "upload-1": existing } }), {
        type: "START_UPLOAD",
        uploadId: "upload-1",
        videoId: "video-1",
        title: "Restarted Video",
      });

      expect(state.uploads["upload-1"]).toEqual({
        uploadId: "upload-1",
        videoId: "video-1",
        title: "Restarted Video",
        progress: 0,
        status: "uploading",
        uploadType: "youtube",
        youtubeVideoId: null,
        errorMessage: null,
        retryCount: 0,
      });
    });

    it("should default uploadType to youtube", () => {
      const state = reduce(createState(), {
        type: "START_UPLOAD",
        uploadId: "upload-1",
        videoId: "video-1",
        title: "My Video",
      });

      expect(state.uploads["upload-1"]!.uploadType).toBe("youtube");
    });

    it("should set uploadType to buffer and initialize bufferStage to copying", () => {
      const state = reduce(createState(), {
        type: "START_UPLOAD",
        uploadId: "upload-1",
        videoId: "video-1",
        title: "Social Post",
        uploadType: "buffer",
      });

      const upload = state.uploads["upload-1"]!;
      expect(upload.uploadType).toBe("buffer");
      expect(upload.uploadType === "buffer" && upload.bufferStage).toBe(
        "copying"
      );
    });

    it("should set uploadType to ai-hero and initialize aiHeroSlug to null", () => {
      const state = reduce(createState(), {
        type: "START_UPLOAD",
        uploadId: "upload-1",
        videoId: "video-1",
        title: "AI Hero Post",
        uploadType: "ai-hero",
      });

      expect(state.uploads["upload-1"]).toEqual({
        uploadId: "upload-1",
        videoId: "video-1",
        title: "AI Hero Post",
        progress: 0,
        status: "uploading",
        uploadType: "ai-hero",
        aiHeroSlug: null,
        errorMessage: null,
        retryCount: 0,
      });
    });

    it("should set uploadType to export and initialize exportStage to concatenating-clips", () => {
      const state = reduce(createState(), {
        type: "START_UPLOAD",
        uploadId: "upload-1",
        videoId: "video-1",
        title: "Export Video",
        uploadType: "export",
      });

      expect(state.uploads["upload-1"]).toEqual({
        uploadId: "upload-1",
        videoId: "video-1",
        title: "Export Video",
        progress: 0,
        status: "uploading",
        uploadType: "export",
        exportStage: "concatenating-clips",
        errorMessage: null,
        retryCount: 0,
      });
    });
  });

  describe("UPDATE_PROGRESS", () => {
    it("should update progress for existing upload", () => {
      const state = reduce(
        createState({
          uploads: { "upload-1": createYouTubeEntry() },
        }),
        { type: "UPDATE_PROGRESS", uploadId: "upload-1", progress: 42 }
      );

      expect(state.uploads["upload-1"]!.progress).toBe(42);
    });

    it("should not modify state for non-existent upload", () => {
      const initial = createState();
      const state = reduce(initial, {
        type: "UPDATE_PROGRESS",
        uploadId: "non-existent",
        progress: 50,
      });

      expect(state).toBe(initial);
    });

    it("should not affect other uploads", () => {
      const upload1 = createYouTubeEntry({
        uploadId: "upload-1",
        progress: 10,
      });
      const upload2 = createYouTubeEntry({
        uploadId: "upload-2",
        progress: 20,
      });
      const state = reduce(
        createState({
          uploads: { "upload-1": upload1, "upload-2": upload2 },
        }),
        { type: "UPDATE_PROGRESS", uploadId: "upload-1", progress: 75 }
      );

      expect(state.uploads["upload-1"]!.progress).toBe(75);
      expect(state.uploads["upload-2"]!.progress).toBe(20);
    });
  });

  describe("UPDATE_BUFFER_STAGE", () => {
    it("should update buffer stage for existing upload", () => {
      const state = reduce(
        createState({
          uploads: {
            "upload-1": createBufferEntry({ bufferStage: "copying" }),
          },
        }),
        { type: "UPDATE_BUFFER_STAGE", uploadId: "upload-1", stage: "syncing" }
      );

      const upload = state.uploads["upload-1"]!;
      expect(upload.uploadType === "buffer" && upload.bufferStage).toBe(
        "syncing"
      );
    });

    it("should transition from syncing to sending-webhook", () => {
      const state = reduce(
        createState({
          uploads: {
            "upload-1": createBufferEntry({ bufferStage: "syncing" }),
          },
        }),
        {
          type: "UPDATE_BUFFER_STAGE",
          uploadId: "upload-1",
          stage: "sending-webhook",
        }
      );

      const upload = state.uploads["upload-1"]!;
      expect(upload.uploadType === "buffer" && upload.bufferStage).toBe(
        "sending-webhook"
      );
    });

    it("should not modify state for non-existent upload", () => {
      const initial = createState();
      const state = reduce(initial, {
        type: "UPDATE_BUFFER_STAGE",
        uploadId: "non-existent",
        stage: "syncing",
      });

      expect(state).toBe(initial);
    });

    it("should not modify state for non-buffer upload", () => {
      const initial = createState({
        uploads: { "upload-1": createYouTubeEntry() },
      });
      const state = reduce(initial, {
        type: "UPDATE_BUFFER_STAGE",
        uploadId: "upload-1",
        stage: "syncing",
      });

      expect(state).toBe(initial);
    });
  });

  describe("UPDATE_EXPORT_STAGE", () => {
    it("should update export stage for existing upload", () => {
      const state = reduce(
        createState({
          uploads: {
            "upload-1": createExportEntry({
              exportStage: "concatenating-clips",
            }),
          },
        }),
        {
          type: "UPDATE_EXPORT_STAGE",
          uploadId: "upload-1",
          stage: "normalizing-audio",
        }
      );

      const upload = state.uploads["upload-1"]!;
      expect(upload.uploadType === "export" && upload.exportStage).toBe(
        "normalizing-audio"
      );
    });

    it("should not modify state for non-existent upload", () => {
      const initial = createState();
      const state = reduce(initial, {
        type: "UPDATE_EXPORT_STAGE",
        uploadId: "non-existent",
        stage: "normalizing-audio",
      });

      expect(state).toBe(initial);
    });

    it("should not modify state for non-export upload", () => {
      const initial = createState({
        uploads: { "upload-1": createYouTubeEntry() },
      });
      const state = reduce(initial, {
        type: "UPDATE_EXPORT_STAGE",
        uploadId: "upload-1",
        stage: "normalizing-audio",
      });

      expect(state).toBe(initial);
    });
  });

  describe("UPLOAD_SUCCESS", () => {
    it("should set status to success and store youtube video id", () => {
      const state = reduce(
        createState({
          uploads: {
            "upload-1": createYouTubeEntry({ progress: 95 }),
          },
        }),
        {
          type: "UPLOAD_SUCCESS",
          uploadId: "upload-1",
          youtubeVideoId: "yt-abc123",
        }
      );

      const upload = state.uploads["upload-1"]!;
      expect(upload.status).toBe("success");
      expect(upload.progress).toBe(100);
      expect(upload.uploadType === "youtube" && upload.youtubeVideoId).toBe(
        "yt-abc123"
      );
      expect(upload.errorMessage).toBeNull();
    });

    it("should not modify state for non-existent upload", () => {
      const initial = createState();
      const state = reduce(initial, {
        type: "UPLOAD_SUCCESS",
        uploadId: "non-existent",
        youtubeVideoId: "yt-abc",
      });

      expect(state).toBe(initial);
    });

    it("should clear any previous error message", () => {
      const state = reduce(
        createState({
          uploads: {
            "upload-1": createYouTubeEntry({
              errorMessage: "previous error",
              status: "uploading",
            }),
          },
        }),
        {
          type: "UPLOAD_SUCCESS",
          uploadId: "upload-1",
          youtubeVideoId: "yt-abc",
        }
      );

      expect(state.uploads["upload-1"]!.errorMessage).toBeNull();
    });

    it("should work without youtubeVideoId for buffer uploads", () => {
      const state = reduce(
        createState({
          uploads: {
            "upload-1": createBufferEntry({
              bufferStage: "sending-webhook",
              progress: 100,
            }),
          },
        }),
        {
          type: "UPLOAD_SUCCESS",
          uploadId: "upload-1",
        }
      );

      const upload = state.uploads["upload-1"]!;
      expect(upload.status).toBe("success");
      expect(upload.progress).toBe(100);
      expect(upload.uploadType).toBe("buffer");
    });

    it("should clear bufferStage on success", () => {
      const state = reduce(
        createState({
          uploads: {
            "upload-1": createBufferEntry({
              bufferStage: "sending-webhook",
            }),
          },
        }),
        {
          type: "UPLOAD_SUCCESS",
          uploadId: "upload-1",
        }
      );

      const upload = state.uploads["upload-1"]!;
      expect(upload.uploadType === "buffer" && upload.bufferStage).toBeNull();
    });

    it("should store aiHeroSlug for ai-hero uploads", () => {
      const state = reduce(
        createState({
          uploads: {
            "upload-1": createAiHeroEntry({ progress: 95 }),
          },
        }),
        {
          type: "UPLOAD_SUCCESS",
          uploadId: "upload-1",
          aiHeroSlug: "my-post~abc123",
        }
      );

      const upload = state.uploads["upload-1"]!;
      expect(upload.status).toBe("success");
      expect(upload.progress).toBe(100);
      expect(upload.uploadType === "ai-hero" && upload.aiHeroSlug).toBe(
        "my-post~abc123"
      );
      expect(upload.errorMessage).toBeNull();
    });

    it("should clear exportStage on success for export uploads", () => {
      const state = reduce(
        createState({
          uploads: {
            "upload-1": createExportEntry({
              exportStage: "normalizing-audio",
            }),
          },
        }),
        {
          type: "UPLOAD_SUCCESS",
          uploadId: "upload-1",
        }
      );

      const upload = state.uploads["upload-1"]!;
      expect(upload.status).toBe("success");
      expect(upload.progress).toBe(100);
      expect(upload.uploadType).toBe("export");
      expect(upload.uploadType === "export" && upload.exportStage).toBeNull();
    });
  });

  describe("UPLOAD_ERROR", () => {
    it("should transition to retrying when retryCount < 3", () => {
      const state = reduce(
        createState({
          uploads: {
            "upload-1": createYouTubeEntry({ retryCount: 0 }),
          },
        }),
        {
          type: "UPLOAD_ERROR",
          uploadId: "upload-1",
          errorMessage: "Network error",
        }
      );

      const upload = state.uploads["upload-1"]!;
      expect(upload.status).toBe("retrying");
      expect(upload.retryCount).toBe(1);
      expect(upload.errorMessage).toBe("Network error");
    });

    it("should transition to retrying on second error", () => {
      const state = reduce(
        createState({
          uploads: {
            "upload-1": createYouTubeEntry({ retryCount: 1 }),
          },
        }),
        {
          type: "UPLOAD_ERROR",
          uploadId: "upload-1",
          errorMessage: "Network error again",
        }
      );

      const upload = state.uploads["upload-1"]!;
      expect(upload.status).toBe("retrying");
      expect(upload.retryCount).toBe(2);
    });

    it("should transition to error when retryCount reaches 3", () => {
      const state = reduce(
        createState({
          uploads: {
            "upload-1": createYouTubeEntry({ retryCount: 2 }),
          },
        }),
        {
          type: "UPLOAD_ERROR",
          uploadId: "upload-1",
          errorMessage: "Final failure",
        }
      );

      const upload = state.uploads["upload-1"]!;
      expect(upload.status).toBe("error");
      expect(upload.retryCount).toBe(3);
      expect(upload.errorMessage).toBe("Final failure");
    });

    it("should not modify state for non-existent upload", () => {
      const initial = createState();
      const state = reduce(initial, {
        type: "UPLOAD_ERROR",
        uploadId: "non-existent",
        errorMessage: "error",
      });

      expect(state).toBe(initial);
    });
  });

  describe("RETRY", () => {
    it("should reset status to uploading and progress to 0", () => {
      const state = reduce(
        createState({
          uploads: {
            "upload-1": createYouTubeEntry({
              status: "retrying",
              retryCount: 1,
              progress: 50,
            }),
          },
        }),
        { type: "RETRY", uploadId: "upload-1" }
      );

      const upload = state.uploads["upload-1"]!;
      expect(upload.status).toBe("uploading");
      expect(upload.progress).toBe(0);
      expect(upload.retryCount).toBe(1);
    });

    it("should not modify state for non-existent upload", () => {
      const initial = createState();
      const state = reduce(initial, {
        type: "RETRY",
        uploadId: "non-existent",
      });

      expect(state).toBe(initial);
    });

    it("should reset bufferStage to copying for buffer uploads", () => {
      const state = reduce(
        createState({
          uploads: {
            "upload-1": createBufferEntry({
              bufferStage: "syncing",
              status: "retrying",
              retryCount: 1,
            }),
          },
        }),
        { type: "RETRY", uploadId: "upload-1" }
      );

      const upload = state.uploads["upload-1"]!;
      expect(upload.uploadType === "buffer" && upload.bufferStage).toBe(
        "copying"
      );
    });

    it("should keep youtube type on retry", () => {
      const state = reduce(
        createState({
          uploads: {
            "upload-1": createYouTubeEntry({
              status: "retrying",
              retryCount: 1,
            }),
          },
        }),
        { type: "RETRY", uploadId: "upload-1" }
      );

      expect(state.uploads["upload-1"]!.uploadType).toBe("youtube");
    });

    it("should reset aiHeroSlug to null for ai-hero uploads", () => {
      const state = reduce(
        createState({
          uploads: {
            "upload-1": createAiHeroEntry({
              status: "retrying",
              retryCount: 1,
              aiHeroSlug: "old-slug~123",
            }),
          },
        }),
        { type: "RETRY", uploadId: "upload-1" }
      );

      const upload = state.uploads["upload-1"]!;
      expect(upload.uploadType).toBe("ai-hero");
      expect(upload.uploadType === "ai-hero" && upload.aiHeroSlug).toBeNull();
      expect(upload.status).toBe("uploading");
      expect(upload.progress).toBe(0);
    });
  });

  describe("DISMISS", () => {
    it("should remove upload from state", () => {
      const state = reduce(
        createState({
          uploads: {
            "upload-1": createYouTubeEntry({
              status: "success",
            }),
          },
        }),
        { type: "DISMISS", uploadId: "upload-1" }
      );

      expect(state.uploads["upload-1"]).toBeUndefined();
      expect(Object.keys(state.uploads)).toHaveLength(0);
    });

    it("should not affect other uploads", () => {
      const upload2 = createYouTubeEntry({
        uploadId: "upload-2",
        videoId: "video-2",
      });
      const state = reduce(
        createState({
          uploads: {
            "upload-1": createYouTubeEntry(),
            "upload-2": upload2,
          },
        }),
        { type: "DISMISS", uploadId: "upload-1" }
      );

      expect(state.uploads["upload-1"]).toBeUndefined();
      expect(state.uploads["upload-2"]).toEqual(upload2);
    });

    it("should handle dismissing non-existent upload gracefully", () => {
      const upload1 = createYouTubeEntry();
      const state = reduce(createState({ uploads: { "upload-1": upload1 } }), {
        type: "DISMISS",
        uploadId: "non-existent",
      });

      expect(state.uploads["upload-1"]).toEqual(upload1);
    });

    it("should allow dismissing an upload that is still uploading", () => {
      const state = reduce(
        createState({
          uploads: {
            "upload-1": createYouTubeEntry({
              status: "uploading",
              progress: 50,
            }),
          },
        }),
        { type: "DISMISS", uploadId: "upload-1" }
      );

      expect(state.uploads["upload-1"]).toBeUndefined();
    });
  });

  describe("multiple concurrent uploads", () => {
    it("should handle starting multiple uploads", () => {
      let state = createState();

      state = reduce(state, {
        type: "START_UPLOAD",
        uploadId: "upload-1",
        videoId: "video-1",
        title: "First Video",
      });
      state = reduce(state, {
        type: "START_UPLOAD",
        uploadId: "upload-2",
        videoId: "video-2",
        title: "Second Video",
      });
      state = reduce(state, {
        type: "START_UPLOAD",
        uploadId: "upload-3",
        videoId: "video-3",
        title: "Third Video",
      });

      expect(Object.keys(state.uploads)).toHaveLength(3);
      expect(state.uploads["upload-1"]!.title).toBe("First Video");
      expect(state.uploads["upload-2"]!.title).toBe("Second Video");
      expect(state.uploads["upload-3"]!.title).toBe("Third Video");
    });

    it("should update progress independently per upload", () => {
      let state = createState({
        uploads: {
          "upload-1": createYouTubeEntry({ uploadId: "upload-1" }),
          "upload-2": createYouTubeEntry({ uploadId: "upload-2" }),
        },
      });

      state = reduce(state, {
        type: "UPDATE_PROGRESS",
        uploadId: "upload-1",
        progress: 75,
      });
      state = reduce(state, {
        type: "UPDATE_PROGRESS",
        uploadId: "upload-2",
        progress: 30,
      });

      expect(state.uploads["upload-1"]!.progress).toBe(75);
      expect(state.uploads["upload-2"]!.progress).toBe(30);
    });

    it("should handle mixed statuses across uploads", () => {
      let state = createState({
        uploads: {
          "upload-1": createYouTubeEntry({ uploadId: "upload-1" }),
          "upload-2": createYouTubeEntry({ uploadId: "upload-2" }),
          "upload-3": createYouTubeEntry({
            uploadId: "upload-3",
            retryCount: 2,
          }),
        },
      });

      state = reduce(state, {
        type: "UPLOAD_SUCCESS",
        uploadId: "upload-1",
        youtubeVideoId: "yt-1",
      });
      state = reduce(state, {
        type: "UPLOAD_ERROR",
        uploadId: "upload-2",
        errorMessage: "failed",
      });
      state = reduce(state, {
        type: "UPLOAD_ERROR",
        uploadId: "upload-3",
        errorMessage: "final fail",
      });

      expect(state.uploads["upload-1"]!.status).toBe("success");
      expect(state.uploads["upload-2"]!.status).toBe("retrying");
      expect(state.uploads["upload-3"]!.status).toBe("error");
    });

    it("should handle concurrent youtube and buffer uploads", () => {
      let state = createState();

      state = reduce(state, {
        type: "START_UPLOAD",
        uploadId: "yt-1",
        videoId: "video-1",
        title: "YouTube Upload",
        uploadType: "youtube",
      });
      state = reduce(state, {
        type: "START_UPLOAD",
        uploadId: "buf-1",
        videoId: "video-1",
        title: "Buffer Post",
        uploadType: "buffer",
      });

      expect(state.uploads["yt-1"]!.uploadType).toBe("youtube");
      expect(state.uploads["buf-1"]!.uploadType).toBe("buffer");

      const bufUpload = state.uploads["buf-1"]!;
      expect(bufUpload.uploadType === "buffer" && bufUpload.bufferStage).toBe(
        "copying"
      );

      // Progress YouTube
      state = reduce(state, {
        type: "UPDATE_PROGRESS",
        uploadId: "yt-1",
        progress: 50,
      });
      // Progress Buffer through stages
      state = reduce(state, {
        type: "UPDATE_PROGRESS",
        uploadId: "buf-1",
        progress: 100,
      });
      state = reduce(state, {
        type: "UPDATE_BUFFER_STAGE",
        uploadId: "buf-1",
        stage: "syncing",
      });

      expect(state.uploads["yt-1"]!.progress).toBe(50);
      const bufAfterStage = state.uploads["buf-1"]!;
      expect(
        bufAfterStage.uploadType === "buffer" && bufAfterStage.bufferStage
      ).toBe("syncing");

      // Complete both
      state = reduce(state, {
        type: "UPLOAD_SUCCESS",
        uploadId: "yt-1",
        youtubeVideoId: "yt-abc",
      });
      state = reduce(state, {
        type: "UPLOAD_SUCCESS",
        uploadId: "buf-1",
      });

      expect(state.uploads["yt-1"]!.status).toBe("success");
      const ytSuccess = state.uploads["yt-1"]!;
      expect(
        ytSuccess.uploadType === "youtube" && ytSuccess.youtubeVideoId
      ).toBe("yt-abc");
      expect(state.uploads["buf-1"]!.status).toBe("success");
      const bufSuccess = state.uploads["buf-1"]!;
      expect(
        bufSuccess.uploadType === "buffer" && bufSuccess.bufferStage
      ).toBeNull();
    });

    it("should handle concurrent uploads across all three types", () => {
      let state = createState();

      state = reduce(state, {
        type: "START_UPLOAD",
        uploadId: "yt-1",
        videoId: "video-1",
        title: "YouTube Upload",
        uploadType: "youtube",
      });
      state = reduce(state, {
        type: "START_UPLOAD",
        uploadId: "buf-1",
        videoId: "video-1",
        title: "Buffer Post",
        uploadType: "buffer",
      });
      state = reduce(state, {
        type: "START_UPLOAD",
        uploadId: "ah-1",
        videoId: "video-1",
        title: "AI Hero Post",
        uploadType: "ai-hero",
      });

      expect(Object.keys(state.uploads)).toHaveLength(3);
      expect(state.uploads["yt-1"]!.uploadType).toBe("youtube");
      expect(state.uploads["buf-1"]!.uploadType).toBe("buffer");
      expect(state.uploads["ah-1"]!.uploadType).toBe("ai-hero");

      // Progress all three
      state = reduce(state, {
        type: "UPDATE_PROGRESS",
        uploadId: "yt-1",
        progress: 30,
      });
      state = reduce(state, {
        type: "UPDATE_PROGRESS",
        uploadId: "buf-1",
        progress: 60,
      });
      state = reduce(state, {
        type: "UPDATE_PROGRESS",
        uploadId: "ah-1",
        progress: 45,
      });

      expect(state.uploads["yt-1"]!.progress).toBe(30);
      expect(state.uploads["buf-1"]!.progress).toBe(60);
      expect(state.uploads["ah-1"]!.progress).toBe(45);

      // Complete all three
      state = reduce(state, {
        type: "UPLOAD_SUCCESS",
        uploadId: "yt-1",
        youtubeVideoId: "yt-abc",
      });
      state = reduce(state, {
        type: "UPLOAD_SUCCESS",
        uploadId: "buf-1",
      });
      state = reduce(state, {
        type: "UPLOAD_SUCCESS",
        uploadId: "ah-1",
        aiHeroSlug: "my-post~xyz",
      });

      expect(state.uploads["yt-1"]!.status).toBe("success");
      expect(state.uploads["buf-1"]!.status).toBe("success");
      expect(state.uploads["ah-1"]!.status).toBe("success");

      const ahSuccess = state.uploads["ah-1"]!;
      expect(ahSuccess.uploadType === "ai-hero" && ahSuccess.aiHeroSlug).toBe(
        "my-post~xyz"
      );
    });
  });

  describe("full retry lifecycle", () => {
    it("should go through 3 retries then final error", () => {
      let state = createState();

      // Start upload
      state = reduce(state, {
        type: "START_UPLOAD",
        uploadId: "upload-1",
        videoId: "video-1",
        title: "Flaky Upload",
      });
      expect(state.uploads["upload-1"]!.status).toBe("uploading");

      // First error → retrying (retryCount 1)
      state = reduce(state, {
        type: "UPLOAD_ERROR",
        uploadId: "upload-1",
        errorMessage: "Error 1",
      });
      expect(state.uploads["upload-1"]!.status).toBe("retrying");
      expect(state.uploads["upload-1"]!.retryCount).toBe(1);

      // Context provider would observe "retrying" and call RETRY
      state = reduce(state, { type: "RETRY", uploadId: "upload-1" });
      expect(state.uploads["upload-1"]!.status).toBe("uploading");

      // Second error → retrying (retryCount 2)
      state = reduce(state, {
        type: "UPLOAD_ERROR",
        uploadId: "upload-1",
        errorMessage: "Error 2",
      });
      expect(state.uploads["upload-1"]!.status).toBe("retrying");
      expect(state.uploads["upload-1"]!.retryCount).toBe(2);

      state = reduce(state, { type: "RETRY", uploadId: "upload-1" });
      expect(state.uploads["upload-1"]!.status).toBe("uploading");

      // Third error → final error (retryCount 3)
      state = reduce(state, {
        type: "UPLOAD_ERROR",
        uploadId: "upload-1",
        errorMessage: "Error 3",
      });
      expect(state.uploads["upload-1"]!.status).toBe("error");
      expect(state.uploads["upload-1"]!.retryCount).toBe(3);
      expect(state.uploads["upload-1"]!.errorMessage).toBe("Error 3");
    });

    it("should succeed after retries", () => {
      let state = createState();

      state = reduce(state, {
        type: "START_UPLOAD",
        uploadId: "upload-1",
        videoId: "video-1",
        title: "Eventually Succeeds",
      });

      // First error → retrying
      state = reduce(state, {
        type: "UPLOAD_ERROR",
        uploadId: "upload-1",
        errorMessage: "Transient error",
      });
      state = reduce(state, { type: "RETRY", uploadId: "upload-1" });

      // Succeeds on retry
      state = reduce(state, {
        type: "UPLOAD_SUCCESS",
        uploadId: "upload-1",
        youtubeVideoId: "yt-success",
      });

      expect(state.uploads["upload-1"]!.status).toBe("success");
      const upload = state.uploads["upload-1"]!;
      expect(upload.uploadType === "youtube" && upload.youtubeVideoId).toBe(
        "yt-success"
      );
      expect(upload.retryCount).toBe(1);
    });
  });

  describe("buffer upload lifecycle", () => {
    it("should progress through all buffer stages to success", () => {
      let state = createState();

      // Start buffer upload
      state = reduce(state, {
        type: "START_UPLOAD",
        uploadId: "buf-1",
        videoId: "video-1",
        title: "Social Post",
        uploadType: "buffer",
      });
      const started = state.uploads["buf-1"]!;
      expect(started.uploadType === "buffer" && started.bufferStage).toBe(
        "copying"
      );
      expect(started.uploadType).toBe("buffer");

      // Copying progress
      state = reduce(state, {
        type: "UPDATE_PROGRESS",
        uploadId: "buf-1",
        progress: 50,
      });
      expect(state.uploads["buf-1"]!.progress).toBe(50);

      state = reduce(state, {
        type: "UPDATE_PROGRESS",
        uploadId: "buf-1",
        progress: 100,
      });

      // Transition to syncing
      state = reduce(state, {
        type: "UPDATE_BUFFER_STAGE",
        uploadId: "buf-1",
        stage: "syncing",
      });
      const syncing = state.uploads["buf-1"]!;
      expect(syncing.uploadType === "buffer" && syncing.bufferStage).toBe(
        "syncing"
      );

      // Transition to sending-webhook
      state = reduce(state, {
        type: "UPDATE_BUFFER_STAGE",
        uploadId: "buf-1",
        stage: "sending-webhook",
      });
      const webhook = state.uploads["buf-1"]!;
      expect(webhook.uploadType === "buffer" && webhook.bufferStage).toBe(
        "sending-webhook"
      );

      // Success
      state = reduce(state, {
        type: "UPLOAD_SUCCESS",
        uploadId: "buf-1",
      });
      const success = state.uploads["buf-1"]!;
      expect(success.status).toBe("success");
      expect(success.uploadType === "buffer" && success.bufferStage).toBeNull();
      expect(success.progress).toBe(100);
    });

    it("should handle error during copying stage", () => {
      let state = reduce(createState(), {
        type: "START_UPLOAD",
        uploadId: "buf-1",
        videoId: "video-1",
        title: "Failing Copy",
        uploadType: "buffer",
      });

      state = reduce(state, {
        type: "UPDATE_PROGRESS",
        uploadId: "buf-1",
        progress: 30,
      });

      state = reduce(state, {
        type: "UPLOAD_ERROR",
        uploadId: "buf-1",
        errorMessage: "Disk full",
      });

      expect(state.uploads["buf-1"]!.status).toBe("retrying");
      expect(state.uploads["buf-1"]!.retryCount).toBe(1);
      expect(state.uploads["buf-1"]!.errorMessage).toBe("Disk full");
    });

    it("should handle error during syncing stage", () => {
      let state = reduce(createState(), {
        type: "START_UPLOAD",
        uploadId: "buf-1",
        videoId: "video-1",
        title: "Sync Fail",
        uploadType: "buffer",
      });

      state = reduce(state, {
        type: "UPDATE_BUFFER_STAGE",
        uploadId: "buf-1",
        stage: "syncing",
      });

      state = reduce(state, {
        type: "UPLOAD_ERROR",
        uploadId: "buf-1",
        errorMessage: "Dropbox sync timeout",
      });

      expect(state.uploads["buf-1"]!.status).toBe("retrying");
      expect(state.uploads["buf-1"]!.errorMessage).toBe("Dropbox sync timeout");
    });

    it("should handle error during sending-webhook stage", () => {
      let state = reduce(createState(), {
        type: "START_UPLOAD",
        uploadId: "buf-1",
        videoId: "video-1",
        title: "Webhook Fail",
        uploadType: "buffer",
      });

      state = reduce(state, {
        type: "UPDATE_BUFFER_STAGE",
        uploadId: "buf-1",
        stage: "sending-webhook",
      });

      state = reduce(state, {
        type: "UPLOAD_ERROR",
        uploadId: "buf-1",
        errorMessage: "Zapier webhook failed (500)",
      });

      expect(state.uploads["buf-1"]!.status).toBe("retrying");
    });

    it("should reset bufferStage to copying on retry", () => {
      let state = reduce(createState(), {
        type: "START_UPLOAD",
        uploadId: "buf-1",
        videoId: "video-1",
        title: "Retrying Buffer",
        uploadType: "buffer",
      });

      // Advance to syncing then error
      state = reduce(state, {
        type: "UPDATE_BUFFER_STAGE",
        uploadId: "buf-1",
        stage: "syncing",
      });
      state = reduce(state, {
        type: "UPLOAD_ERROR",
        uploadId: "buf-1",
        errorMessage: "Sync error",
      });

      expect(state.uploads["buf-1"]!.status).toBe("retrying");

      // Retry resets to copying
      state = reduce(state, { type: "RETRY", uploadId: "buf-1" });
      const retried = state.uploads["buf-1"]!;
      expect(retried.status).toBe("uploading");
      expect(retried.uploadType === "buffer" && retried.bufferStage).toBe(
        "copying"
      );
      expect(retried.progress).toBe(0);
    });

    it("should go through full retry lifecycle for buffer upload", () => {
      let state = reduce(createState(), {
        type: "START_UPLOAD",
        uploadId: "buf-1",
        videoId: "video-1",
        title: "Flaky Buffer",
        uploadType: "buffer",
      });

      // First attempt fails during syncing
      state = reduce(state, {
        type: "UPDATE_BUFFER_STAGE",
        uploadId: "buf-1",
        stage: "syncing",
      });
      state = reduce(state, {
        type: "UPLOAD_ERROR",
        uploadId: "buf-1",
        errorMessage: "Error 1",
      });
      expect(state.uploads["buf-1"]!.status).toBe("retrying");

      state = reduce(state, { type: "RETRY", uploadId: "buf-1" });
      const afterRetry = state.uploads["buf-1"]!;
      expect(afterRetry.uploadType === "buffer" && afterRetry.bufferStage).toBe(
        "copying"
      );

      // Second attempt fails during webhook
      state = reduce(state, {
        type: "UPDATE_BUFFER_STAGE",
        uploadId: "buf-1",
        stage: "sending-webhook",
      });
      state = reduce(state, {
        type: "UPLOAD_ERROR",
        uploadId: "buf-1",
        errorMessage: "Error 2",
      });
      expect(state.uploads["buf-1"]!.status).toBe("retrying");

      state = reduce(state, { type: "RETRY", uploadId: "buf-1" });

      // Third attempt fails → final error
      state = reduce(state, {
        type: "UPLOAD_ERROR",
        uploadId: "buf-1",
        errorMessage: "Error 3",
      });
      expect(state.uploads["buf-1"]!.status).toBe("error");
      expect(state.uploads["buf-1"]!.retryCount).toBe(3);
    });

    it("should dismiss buffer upload", () => {
      let state = reduce(createState(), {
        type: "START_UPLOAD",
        uploadId: "buf-1",
        videoId: "video-1",
        title: "Buffer to Dismiss",
        uploadType: "buffer",
      });

      state = reduce(state, { type: "DISMISS", uploadId: "buf-1" });
      expect(state.uploads["buf-1"]).toBeUndefined();
    });
  });

  describe("ai-hero upload lifecycle", () => {
    it("should start ai-hero upload with correct initial state", () => {
      const state = reduce(createState(), {
        type: "START_UPLOAD",
        uploadId: "ah-1",
        videoId: "video-1",
        title: "AI Hero Post",
        uploadType: "ai-hero",
      });

      expect(state.uploads["ah-1"]).toEqual({
        uploadId: "ah-1",
        videoId: "video-1",
        title: "AI Hero Post",
        progress: 0,
        status: "uploading",
        uploadType: "ai-hero",
        aiHeroSlug: null,
        errorMessage: null,
        retryCount: 0,
      });
    });

    it("should update progress for ai-hero upload", () => {
      let state = createState({
        uploads: { "ah-1": createAiHeroEntry({ uploadId: "ah-1" }) },
      });

      state = reduce(state, {
        type: "UPDATE_PROGRESS",
        uploadId: "ah-1",
        progress: 65,
      });

      expect(state.uploads["ah-1"]!.progress).toBe(65);
    });

    it("should complete ai-hero upload with slug", () => {
      let state = createState({
        uploads: {
          "ah-1": createAiHeroEntry({ uploadId: "ah-1", progress: 95 }),
        },
      });

      state = reduce(state, {
        type: "UPLOAD_SUCCESS",
        uploadId: "ah-1",
        aiHeroSlug: "my-article~abc123",
      });

      const upload = state.uploads["ah-1"]!;
      expect(upload.status).toBe("success");
      expect(upload.progress).toBe(100);
      expect(upload.uploadType).toBe("ai-hero");
      expect(upload.uploadType === "ai-hero" && upload.aiHeroSlug).toBe(
        "my-article~abc123"
      );
      expect(upload.errorMessage).toBeNull();
    });

    it("should handle ai-hero upload error", () => {
      let state = createState({
        uploads: {
          "ah-1": createAiHeroEntry({ uploadId: "ah-1", progress: 40 }),
        },
      });

      state = reduce(state, {
        type: "UPLOAD_ERROR",
        uploadId: "ah-1",
        errorMessage: "S3 upload failed",
      });

      expect(state.uploads["ah-1"]!.status).toBe("retrying");
      expect(state.uploads["ah-1"]!.retryCount).toBe(1);
      expect(state.uploads["ah-1"]!.errorMessage).toBe("S3 upload failed");
    });

    it("should retry ai-hero upload resetting progress and slug", () => {
      let state = createState({
        uploads: {
          "ah-1": createAiHeroEntry({
            uploadId: "ah-1",
            status: "retrying",
            retryCount: 1,
            progress: 40,
          }),
        },
      });

      state = reduce(state, { type: "RETRY", uploadId: "ah-1" });

      const upload = state.uploads["ah-1"]!;
      expect(upload.status).toBe("uploading");
      expect(upload.progress).toBe(0);
      expect(upload.uploadType).toBe("ai-hero");
      expect(upload.uploadType === "ai-hero" && upload.aiHeroSlug).toBeNull();
    });

    it("should dismiss ai-hero upload", () => {
      let state = createState({
        uploads: {
          "ah-1": createAiHeroEntry({ uploadId: "ah-1" }),
        },
      });

      state = reduce(state, { type: "DISMISS", uploadId: "ah-1" });
      expect(state.uploads["ah-1"]).toBeUndefined();
    });

    it("should go through full ai-hero lifecycle: start → progress → success", () => {
      let state = createState();

      // Start
      state = reduce(state, {
        type: "START_UPLOAD",
        uploadId: "ah-1",
        videoId: "video-1",
        title: "My AI Hero Article",
        uploadType: "ai-hero",
      });
      expect(state.uploads["ah-1"]!.status).toBe("uploading");
      expect(state.uploads["ah-1"]!.uploadType).toBe("ai-hero");

      // Progress
      state = reduce(state, {
        type: "UPDATE_PROGRESS",
        uploadId: "ah-1",
        progress: 25,
      });
      state = reduce(state, {
        type: "UPDATE_PROGRESS",
        uploadId: "ah-1",
        progress: 50,
      });
      state = reduce(state, {
        type: "UPDATE_PROGRESS",
        uploadId: "ah-1",
        progress: 90,
      });
      expect(state.uploads["ah-1"]!.progress).toBe(90);

      // Success
      state = reduce(state, {
        type: "UPLOAD_SUCCESS",
        uploadId: "ah-1",
        aiHeroSlug: "my-ai-hero-article~def456",
      });

      const upload = state.uploads["ah-1"]!;
      expect(upload.status).toBe("success");
      expect(upload.progress).toBe(100);
      expect(upload.uploadType === "ai-hero" && upload.aiHeroSlug).toBe(
        "my-ai-hero-article~def456"
      );
    });

    it("should go through full ai-hero lifecycle: start → error → retry → success", () => {
      let state = createState();

      // Start
      state = reduce(state, {
        type: "START_UPLOAD",
        uploadId: "ah-1",
        videoId: "video-1",
        title: "Flaky AI Hero Post",
        uploadType: "ai-hero",
      });

      // Progress then error
      state = reduce(state, {
        type: "UPDATE_PROGRESS",
        uploadId: "ah-1",
        progress: 60,
      });
      state = reduce(state, {
        type: "UPLOAD_ERROR",
        uploadId: "ah-1",
        errorMessage: "Connection reset",
      });
      expect(state.uploads["ah-1"]!.status).toBe("retrying");
      expect(state.uploads["ah-1"]!.retryCount).toBe(1);

      // Retry
      state = reduce(state, { type: "RETRY", uploadId: "ah-1" });
      expect(state.uploads["ah-1"]!.status).toBe("uploading");
      expect(state.uploads["ah-1"]!.progress).toBe(0);

      // Success on retry
      state = reduce(state, {
        type: "UPDATE_PROGRESS",
        uploadId: "ah-1",
        progress: 100,
      });
      state = reduce(state, {
        type: "UPLOAD_SUCCESS",
        uploadId: "ah-1",
        aiHeroSlug: "recovered-post~ghi789",
      });

      const upload = state.uploads["ah-1"]!;
      expect(upload.status).toBe("success");
      expect(upload.retryCount).toBe(1);
      expect(upload.uploadType === "ai-hero" && upload.aiHeroSlug).toBe(
        "recovered-post~ghi789"
      );
    });

    it("should go through full ai-hero retry lifecycle to final error", () => {
      let state = createState();

      state = reduce(state, {
        type: "START_UPLOAD",
        uploadId: "ah-1",
        videoId: "video-1",
        title: "Doomed AI Hero Post",
        uploadType: "ai-hero",
      });

      // First error → retrying
      state = reduce(state, {
        type: "UPLOAD_ERROR",
        uploadId: "ah-1",
        errorMessage: "Error 1",
      });
      expect(state.uploads["ah-1"]!.status).toBe("retrying");
      state = reduce(state, { type: "RETRY", uploadId: "ah-1" });

      // Second error → retrying
      state = reduce(state, {
        type: "UPLOAD_ERROR",
        uploadId: "ah-1",
        errorMessage: "Error 2",
      });
      expect(state.uploads["ah-1"]!.status).toBe("retrying");
      state = reduce(state, { type: "RETRY", uploadId: "ah-1" });

      // Third error → final error
      state = reduce(state, {
        type: "UPLOAD_ERROR",
        uploadId: "ah-1",
        errorMessage: "Error 3",
      });
      expect(state.uploads["ah-1"]!.status).toBe("error");
      expect(state.uploads["ah-1"]!.retryCount).toBe(3);
      expect(state.uploads["ah-1"]!.errorMessage).toBe("Error 3");
    });
  });

  describe("export upload lifecycle", () => {
    it("should progress through all export stages to success", () => {
      let state = createState();

      // Start export
      state = reduce(state, {
        type: "START_UPLOAD",
        uploadId: "exp-1",
        videoId: "video-1",
        title: "Export Video",
        uploadType: "export",
      });
      const started = state.uploads["exp-1"]!;
      expect(started.uploadType === "export" && started.exportStage).toBe(
        "concatenating-clips"
      );

      // Transition to normalizing-audio
      state = reduce(state, {
        type: "UPDATE_EXPORT_STAGE",
        uploadId: "exp-1",
        stage: "normalizing-audio",
      });
      const normalizing = state.uploads["exp-1"]!;
      expect(
        normalizing.uploadType === "export" && normalizing.exportStage
      ).toBe("normalizing-audio");

      // Success
      state = reduce(state, {
        type: "UPLOAD_SUCCESS",
        uploadId: "exp-1",
      });
      const success = state.uploads["exp-1"]!;
      expect(success.status).toBe("success");
      expect(success.uploadType === "export" && success.exportStage).toBeNull();
      expect(success.progress).toBe(100);
    });

    it("should reset exportStage to concatenating-clips on retry", () => {
      let state = reduce(createState(), {
        type: "START_UPLOAD",
        uploadId: "exp-1",
        videoId: "video-1",
        title: "Retrying Export",
        uploadType: "export",
      });

      // Advance to normalizing-audio then error
      state = reduce(state, {
        type: "UPDATE_EXPORT_STAGE",
        uploadId: "exp-1",
        stage: "normalizing-audio",
      });
      state = reduce(state, {
        type: "UPLOAD_ERROR",
        uploadId: "exp-1",
        errorMessage: "FFmpeg crashed",
      });

      expect(state.uploads["exp-1"]!.status).toBe("retrying");

      // Retry resets to concatenating-clips
      state = reduce(state, { type: "RETRY", uploadId: "exp-1" });
      const retried = state.uploads["exp-1"]!;
      expect(retried.status).toBe("uploading");
      expect(retried.uploadType === "export" && retried.exportStage).toBe(
        "concatenating-clips"
      );
      expect(retried.progress).toBe(0);
    });

    it("should dismiss export upload", () => {
      let state = createState({
        uploads: {
          "exp-1": createExportEntry({ uploadId: "exp-1" }),
        },
      });

      state = reduce(state, { type: "DISMISS", uploadId: "exp-1" });
      expect(state.uploads["exp-1"]).toBeUndefined();
    });
  });
});
