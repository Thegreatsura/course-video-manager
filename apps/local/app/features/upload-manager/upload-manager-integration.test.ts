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

describe("full integration: reducer + registry through lifecycle", () => {
  it("should handle start → error → retry → success with registry-driven entry creation", () => {
    let state = createState();

    state = reduce(state, {
      type: "START_UPLOAD",
      uploadId: "upload-1",
      videoId: "video-1",
      title: "My Upload",
      uploadType: "buffer",
    });

    const started = state.uploads["upload-1"]!;
    expect(started.uploadType).toBe("buffer");
    expect(started.uploadType === "buffer" && started.bufferStage).toBe(
      "uploading-blob"
    );
    expect(started.status).toBe("uploading");

    state = reduce(state, {
      type: "UPDATE_BUFFER_STAGE",
      uploadId: "upload-1",
      stage: "creating-post",
    });

    state = reduce(state, {
      type: "UPLOAD_ERROR",
      uploadId: "upload-1",
      errorMessage: "Post failed",
    });
    expect(state.uploads["upload-1"]!.status).toBe("retrying");

    state = reduce(state, { type: "RETRY", uploadId: "upload-1" });
    const retried = state.uploads["upload-1"]!;
    expect(retried.status).toBe("uploading");
    expect(retried.uploadType === "buffer" && retried.bufferStage).toBe(
      "uploading-blob"
    );
    expect(retried.progress).toBe(0);

    state = reduce(state, {
      type: "UPLOAD_SUCCESS",
      uploadId: "upload-1",
    });
    const success = state.uploads["upload-1"]!;
    expect(success.status).toBe("success");
    expect(success.uploadType === "buffer" && success.bufferStage).toBeNull();
  });

  it("should handle dependency chain: export → youtube with type-specific fields via registry", () => {
    let state = createState();

    state = reduce(state, {
      type: "START_UPLOAD",
      uploadId: "export-1",
      videoId: "video-1",
      title: "Export",
      uploadType: "export",
    });
    state = reduce(state, {
      type: "START_UPLOAD",
      uploadId: "yt-1",
      videoId: "video-1",
      title: "YouTube Upload",
      dependsOn: "export-1",
    });

    const exportEntry = state.uploads["export-1"]!;
    expect(exportEntry.uploadType === "export" && exportEntry.exportStage).toBe(
      "queued"
    );

    const ytEntry = state.uploads["yt-1"]!;
    expect(ytEntry.status).toBe("waiting");
    expect(ytEntry.uploadType).toBe("youtube");

    state = reduce(state, {
      type: "UPDATE_EXPORT_STAGE",
      uploadId: "export-1",
      stage: "concatenating-clips",
    });
    state = reduce(state, {
      type: "UPLOAD_SUCCESS",
      uploadId: "export-1",
    });

    expect(state.uploads["export-1"]!.status).toBe("success");
    expect(state.uploads["yt-1"]!.status).toBe("uploading");

    state = reduce(state, {
      type: "UPLOAD_SUCCESS",
      uploadId: "yt-1",
      youtubeVideoId: "yt-xyz",
    });

    const ytSuccess = state.uploads["yt-1"]!;
    expect(ytSuccess.status).toBe("success");
    expect(ytSuccess.uploadType === "youtube" && ytSuccess.youtubeVideoId).toBe(
      "yt-xyz"
    );
  });

  it("should handle publish lifecycle: stages → complete → success preserves newDraftVersionId", () => {
    let state = createState();

    state = reduce(state, {
      type: "START_UPLOAD",
      uploadId: "pub-1",
      videoId: "",
      title: "My Course",
      uploadType: "publish",
      courseId: "course-1",
    });

    state = reduce(state, {
      type: "UPDATE_PUBLISH_STAGE",
      uploadId: "pub-1",
      stage: "uploading",
    });

    state = reduce(state, {
      type: "UPDATE_PUBLISH_STAGE",
      uploadId: "pub-1",
      stage: "freezing",
    });

    state = reduce(state, {
      type: "PUBLISH_COMPLETE",
      uploadId: "pub-1",
      newDraftVersionId: "version-42",
    });

    state = reduce(state, {
      type: "UPLOAD_SUCCESS",
      uploadId: "pub-1",
    });

    const success = state.uploads["pub-1"]!;
    expect(success.status).toBe("success");
    if (success.uploadType === "publish") {
      expect(success.newDraftVersionId).toBe("version-42");
      expect(success.courseId).toBe("course-1");
      expect(success.publishStage).toBeNull();
    }
  });
});
