import { describe, expect, it, vi } from "vitest";
import { uploadReducer } from "./upload-reducer";
import { uploadTypeRegistry } from "./upload-type-registry";

const exportConfig = uploadTypeRegistry["export"]!;
const youtubeConfig = uploadTypeRegistry["youtube"]!;
const bufferConfig = uploadTypeRegistry["buffer"]!;

const makeBase = (
  overrides: Partial<uploadReducer.BaseUploadEntry> = {}
): uploadReducer.BaseUploadEntry => ({
  uploadId: "upload-1",
  videoId: "video-1",
  title: "Test Export",
  progress: 0,
  status: "uploading",
  errorMessage: null,
  retryCount: 0,
  terminal: false,
  dependsOn: null,
  parentUploadId: null,
  ...overrides,
});

describe("export registry entry", () => {
  describe("createEntry", () => {
    it("should create an export entry with exportStage queued and isBatchEntry false", () => {
      const base = makeBase();

      const entry = exportConfig.createEntry(base, {
        type: "START_UPLOAD",
        uploadId: "upload-1",
        videoId: "video-1",
        title: "Test Export",
      });

      expect(entry).toEqual({
        ...base,
        uploadType: "export",
        exportStage: "queued",
        isBatchEntry: false,
        videoUploadStage: null,
        uploadedBytes: 0,
        totalBytes: null,
      });
    });

    it("should set isBatchEntry true from action", () => {
      const entry = exportConfig.createEntry(makeBase(), {
        type: "START_UPLOAD",
        uploadId: "upload-1",
        videoId: "video-1",
        title: "Batch Export",
        isBatchEntry: true,
      });

      expect(entry).toMatchObject({
        uploadType: "export",
        isBatchEntry: true,
        videoUploadStage: null,
        uploadedBytes: 0,
        totalBytes: null,
      });
    });

    it("should preserve waiting status from base when dependsOn is set", () => {
      const base = makeBase({ status: "waiting", dependsOn: "upload-0" });

      const entry = exportConfig.createEntry(base, {
        type: "START_UPLOAD",
        uploadId: "upload-1",
        videoId: "video-1",
        title: "Test Export",
      });

      expect(entry.status).toBe("waiting");
      expect(entry.dependsOn).toBe("upload-0");
    });
  });

  describe("resetEntry", () => {
    it("should reset exportStage to queued and preserve isBatchEntry", () => {
      const base = makeBase({
        errorMessage: "some error",
        retryCount: 1,
      });

      const prevEntry: uploadReducer.ExportUploadEntry = {
        ...base,
        uploadType: "export",
        exportStage: "normalizing-audio",
        isBatchEntry: true,
        videoUploadStage: null,
        uploadedBytes: 0,
        totalBytes: null,
      };

      const entry = exportConfig.resetEntry(base, prevEntry);

      expect(entry).toEqual({
        ...base,
        uploadType: "export",
        exportStage: "queued",
        isBatchEntry: true,
        videoUploadStage: null,
        uploadedBytes: 0,
        totalBytes: null,
      });
    });

    it("should preserve isBatchEntry false", () => {
      const base = makeBase({ retryCount: 2 });

      const prevEntry: uploadReducer.ExportUploadEntry = {
        ...base,
        uploadType: "export",
        exportStage: "concatenating-clips",
        isBatchEntry: false,
        videoUploadStage: null,
        uploadedBytes: 0,
        totalBytes: null,
      };

      const entry = exportConfig.resetEntry(base, prevEntry);

      expect(entry).toMatchObject({
        uploadType: "export",
        exportStage: "queued",
        isBatchEntry: false,
        videoUploadStage: null,
        uploadedBytes: 0,
        totalBytes: null,
      });
    });
  });

  describe("applySuccess", () => {
    it("should set status to success, clear exportStage, and preserve isBatchEntry", () => {
      const entry: uploadReducer.ExportUploadEntry = {
        uploadId: "upload-1",
        videoId: "video-1",
        title: "Test Export",
        progress: 80,
        status: "uploading",
        uploadType: "export",
        exportStage: "normalizing-audio",
        isBatchEntry: false,
        videoUploadStage: null,
        uploadedBytes: 0,
        totalBytes: null,
        errorMessage: null,
        retryCount: 0,
        terminal: false,
        dependsOn: null,
        parentUploadId: null,
      };

      const result = exportConfig.applySuccess(entry, {
        type: "UPLOAD_SUCCESS",
        uploadId: "upload-1",
      });

      expect(result).toEqual({
        ...entry,
        status: "success",
        progress: 100,
        errorMessage: null,
        exportStage: null,
      });
    });

    it("should preserve isBatchEntry true on success", () => {
      const entry: uploadReducer.ExportUploadEntry = {
        uploadId: "upload-1",
        videoId: "video-1",
        title: "Batch Export",
        progress: 80,
        status: "uploading",
        uploadType: "export",
        exportStage: "normalizing-audio",
        isBatchEntry: true,
        videoUploadStage: null,
        uploadedBytes: 0,
        totalBytes: null,
        errorMessage: null,
        retryCount: 0,
        terminal: false,
        dependsOn: null,
        parentUploadId: null,
      };

      const result = exportConfig.applySuccess(entry, {
        type: "UPLOAD_SUCCESS",
        uploadId: "upload-1",
      });

      expect(result.isBatchEntry).toBe(true);
      expect(result.exportStage).toBeNull();
      expect(result.status).toBe("success");
    });
  });
});

describe("youtube registry entry", () => {
  describe("resetEntry", () => {
    it("should preserve youtubeVideoId from previous entry", () => {
      const base = makeBase({
        errorMessage: "some error",
        retryCount: 1,
      });

      const prevEntry: uploadReducer.YouTubeUploadEntry = {
        ...base,
        uploadType: "youtube",
        youtubeVideoId: "yt-abc123",
      };

      const entry = youtubeConfig.resetEntry(base, prevEntry);

      expect(entry).toEqual({
        ...base,
        uploadType: "youtube",
        youtubeVideoId: "yt-abc123",
      });
    });

    it("should preserve null youtubeVideoId", () => {
      const base = makeBase({ retryCount: 2 });

      const prevEntry: uploadReducer.YouTubeUploadEntry = {
        ...base,
        uploadType: "youtube",
        youtubeVideoId: null,
      };

      const entry = youtubeConfig.resetEntry(base, prevEntry);

      expect(entry).toMatchObject({
        uploadType: "youtube",
        youtubeVideoId: null,
      });
    });
  });

  describe("applySuccess", () => {
    it("should set status to success and store youtubeVideoId", () => {
      const entry: uploadReducer.YouTubeUploadEntry = {
        uploadId: "upload-1",
        videoId: "video-1",
        title: "Test Video",
        progress: 80,
        status: "uploading",
        uploadType: "youtube",
        youtubeVideoId: null,
        errorMessage: null,
        retryCount: 0,
        terminal: false,
        dependsOn: null,
        parentUploadId: null,
      };

      const result = youtubeConfig.applySuccess(entry, {
        type: "UPLOAD_SUCCESS",
        uploadId: "upload-1",
        youtubeVideoId: "yt-abc123",
      });

      expect(result).toEqual({
        ...entry,
        status: "success",
        progress: 100,
        errorMessage: null,
        youtubeVideoId: "yt-abc123",
      });
    });
  });

  describe("initiate", () => {
    it("should call startSSEUpload with correct params and wire dispatch", async () => {
      const { startSSEUpload } = await import("./sse-upload-client");
      vi.mocked(startSSEUpload);

      const dispatch = vi.fn();
      const abortControllers = new Map<string, AbortController>();

      const entry: uploadReducer.YouTubeUploadEntry = {
        uploadId: "upload-1",
        videoId: "video-1",
        title: "Test Video",
        progress: 0,
        status: "uploading",
        uploadType: "youtube",
        youtubeVideoId: null,
        errorMessage: null,
        retryCount: 0,
        terminal: false,
        dependsOn: null,
        parentUploadId: null,
      };

      const params = {
        description: "A test video",
        privacyStatus: "unlisted" as const,
        thumbnailId: "thumb-1",
      };

      youtubeConfig.initiate!(
        "upload-1",
        entry,
        params,
        dispatch,
        abortControllers
      );

      expect(abortControllers.has("upload-1")).toBe(true);
    });

    it("should abort existing controller before starting new one", () => {
      const dispatch = vi.fn();
      const abortControllers = new Map<string, AbortController>();
      const existingController = new AbortController();
      const abortSpy = vi.spyOn(existingController, "abort");
      abortControllers.set("upload-1", existingController);

      const entry: uploadReducer.YouTubeUploadEntry = {
        uploadId: "upload-1",
        videoId: "video-1",
        title: "Test Video",
        progress: 0,
        status: "uploading",
        uploadType: "youtube",
        youtubeVideoId: null,
        errorMessage: null,
        retryCount: 0,
        terminal: false,
        dependsOn: null,
        parentUploadId: null,
      };

      youtubeConfig.initiate!(
        "upload-1",
        entry,
        {
          description: "desc",
          privacyStatus: "public" as const,
          thumbnailId: "thumb-1",
        },
        dispatch,
        abortControllers
      );

      expect(abortSpy).toHaveBeenCalled();
    });
  });
});

describe("buffer registry entry", () => {
  describe("createEntry", () => {
    it("should create a buffer entry with bufferStage copying", () => {
      const base = makeBase();

      const entry = bufferConfig.createEntry(base, {
        type: "START_UPLOAD",
        uploadId: "upload-1",
        videoId: "video-1",
        title: "Test Social Post",
      });

      expect(entry).toEqual({
        ...base,
        uploadType: "buffer",
        bufferStage: "uploading-blob",
      });
    });
  });

  describe("resetEntry", () => {
    it("should reset bufferStage to copying", () => {
      const base = makeBase({
        errorMessage: "some error",
        retryCount: 1,
      });

      const prevEntry: uploadReducer.BufferUploadEntry = {
        ...base,
        uploadType: "buffer",
        bufferStage: "creating-post",
      };

      const entry = bufferConfig.resetEntry(base, prevEntry);

      expect(entry).toEqual({
        ...base,
        uploadType: "buffer",
        bufferStage: "uploading-blob",
      });
    });
  });

  describe("applySuccess", () => {
    it("should set status to success and clear bufferStage", () => {
      const entry: uploadReducer.BufferUploadEntry = {
        uploadId: "upload-1",
        videoId: "video-1",
        title: "Test Social Post",
        progress: 80,
        status: "uploading",
        uploadType: "buffer",
        bufferStage: "creating-post",
        errorMessage: null,
        retryCount: 0,
        terminal: false,
        dependsOn: null,
        parentUploadId: null,
      };

      const result = bufferConfig.applySuccess(entry, {
        type: "UPLOAD_SUCCESS",
        uploadId: "upload-1",
      });

      expect(result).toEqual({
        ...entry,
        status: "success",
        progress: 100,
        errorMessage: null,
        bufferStage: null,
      });
    });
  });
});
