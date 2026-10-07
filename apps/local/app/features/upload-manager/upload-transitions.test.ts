import { describe, expect, it } from "vitest";
import { createInitialUploadState, uploadReducer } from "./upload-reducer";
import { planUploadReactions } from "./upload-transitions";

/** Drives the real reducer through `actions`, returning every snapshot. */
const run = (...actions: uploadReducer.Action[]) =>
  actions.reduce<uploadReducer.State[]>(
    (states, action) => [...states, uploadReducer(states.at(-1)!, action)],
    [createInitialUploadState()]
  );

/** The reactions to the last action, as the provider's effect sees them. */
const reactionsToLast = (
  states: uploadReducer.State[],
  params: Map<string, { params: unknown }>
) =>
  planUploadReactions(states.at(-2)!.uploads, states.at(-1)!.uploads, params);

const initiated = (reactions: ReturnType<typeof planUploadReactions>) =>
  reactions.flatMap((r) =>
    r.type === "initiate"
      ? [{ uploadId: r.uploadId, params: r.params, retry: r.retry }]
      : []
  );

describe("planUploadReactions", () => {
  it("restarts a failed upload the reducer retries, with the params it started with", () => {
    const params = new Map([["social-1", { params: { caption: "Hi" } }]]);
    const states = run(
      {
        type: "START_UPLOAD",
        uploadId: "social-1",
        videoId: "video-1",
        title: "Post",
        uploadType: "buffer",
      },
      { type: "UPLOAD_ERROR", uploadId: "social-1", errorMessage: "Boom" }
    );

    expect(initiated(reactionsToLast(states, params))).toEqual([
      { uploadId: "social-1", params: { caption: "Hi" }, retry: true },
    ]);
  });

  it("starts a waiting upload, with its own params, once its dependency succeeds", () => {
    const params = new Map([
      ["yt-1", { params: { description: "D", privacyStatus: "public" } }],
    ]);
    const states = run(
      {
        type: "START_UPLOAD",
        uploadId: "export-1",
        videoId: "video-1",
        title: "Export",
        uploadType: "export",
      },
      {
        type: "START_UPLOAD",
        uploadId: "yt-1",
        videoId: "video-1",
        title: "YouTube",
        dependsOn: "export-1",
      },
      { type: "UPLOAD_SUCCESS", uploadId: "export-1" }
    );

    expect(initiated(reactionsToLast(states, params))).toEqual([
      {
        uploadId: "yt-1",
        params: { description: "D", privacyStatus: "public" },
        retry: false,
      },
    ]);
  });

  it("restarts nothing once an upload has failed for good, and toasts the failure", () => {
    const fail = {
      type: "UPLOAD_ERROR",
      uploadId: "export-1",
      errorMessage: "Boom",
    } as const;
    const retry = { type: "RETRY", uploadId: "export-1" } as const;
    const states = run(
      {
        type: "START_UPLOAD",
        uploadId: "export-1",
        videoId: "video-1",
        title: "Export",
        uploadType: "export",
      },
      {
        type: "START_UPLOAD",
        uploadId: "yt-1",
        videoId: "video-1",
        title: "YouTube",
        dependsOn: "export-1",
      },
      fail,
      retry,
      fail,
      retry,
      fail
    );

    const reactions = reactionsToLast(states, new Map());
    expect(initiated(reactions)).toEqual([]);
    expect(
      reactions.flatMap((r) =>
        r.type === "error-toast" ? [r.upload.uploadId] : []
      )
    ).toEqual(["export-1", "yt-1"]);
  });
});
