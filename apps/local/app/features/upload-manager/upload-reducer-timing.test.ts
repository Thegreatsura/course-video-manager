import { describe, expect, it } from "vitest";
import { createInitialUploadState, uploadReducer } from "./upload-reducer";
import { SAMPLE_WINDOW_MS } from "./upload-timing";

/** Apply actions, each stamped with the clock reading given beside it. */
const run = (
  steps: Array<[number, uploadReducer.Action]>,
  state = createInitialUploadState()
) =>
  steps.reduce(
    (current, [at, action]) => uploadReducer(current, { ...action, at }),
    state
  );

const startExport = (uploadId = "u1"): uploadReducer.Action => ({
  type: "START_UPLOAD",
  uploadId,
  videoId: "v1",
  title: "Video",
  uploadType: "export",
});

describe("upload timings", () => {
  it("starts timing a job at the moment it starts", () => {
    const state = run([[1_000, startExport()]]);
    expect(state.timings.u1).toMatchObject({
      stage: "queued",
      stageStartedAt: 1_000,
      samples: [{ at: 1_000, progress: 0 }],
      completed: [],
    });
  });

  it("samples the bar as it moves", () => {
    const state = run([
      [0, startExport()],
      [
        1_000,
        {
          type: "UPDATE_EXPORT_STAGE",
          uploadId: "u1",
          stage: "concatenating-clips",
        },
      ],
      [
        2_000,
        {
          type: "UPDATE_EXPORT_PROGRESS",
          uploadId: "u1",
          stage: "concatenating-clips",
          percent: 10,
        },
      ],
      [
        3_000,
        {
          type: "UPDATE_EXPORT_PROGRESS",
          uploadId: "u1",
          stage: "concatenating-clips",
          percent: 20,
        },
      ],
    ]);
    expect(state.timings.u1!.samples).toEqual([
      { at: 1_000, progress: 0 },
      { at: 2_000, progress: 8 },
      { at: 3_000, progress: 16 },
    ]);
  });

  it("keeps only the recent window of samples", () => {
    const steps: Array<[number, uploadReducer.Action]> = [
      [0, startExport()],
      [
        0,
        {
          type: "UPDATE_EXPORT_STAGE",
          uploadId: "u1",
          stage: "concatenating-clips",
        },
      ],
    ];
    for (let percent = 1; percent <= 60; percent++) {
      steps.push([
        percent * 1_000,
        {
          type: "UPDATE_EXPORT_PROGRESS",
          uploadId: "u1",
          stage: "concatenating-clips",
          percent,
        },
      ]);
    }
    const samples = run(steps).timings.u1!.samples;
    expect(samples[0]!.at).toBeGreaterThanOrEqual(60_000 - SAMPLE_WINDOW_MS);
    expect(samples[samples.length - 1]!.at).toBe(60_000);
  });

  it("records a work stage's duration when the job moves on", () => {
    const state = run([
      [0, startExport()],
      [
        1_000,
        {
          type: "UPDATE_EXPORT_STAGE",
          uploadId: "u1",
          stage: "concatenating-clips",
        },
      ],
      [
        61_000,
        {
          type: "UPDATE_EXPORT_STAGE",
          uploadId: "u1",
          stage: "normalizing-audio",
        },
      ],
      [71_000, { type: "UPLOAD_SUCCESS", uploadId: "u1" }],
    ]);
    // The queue is a wait, not a duration worth remembering.
    expect(state.timings.u1!.completed).toEqual([
      { key: "export:concatenating-clips", durationMs: 60_000, units: null },
      { key: "export:normalizing-audio", durationMs: 10_000, units: null },
    ]);
    expect(state.timings.u1!).toMatchObject({ stage: null, endedAt: 71_000 });
  });

  it("records an upload's size alongside its duration", () => {
    const state = run([
      [
        0,
        {
          type: "START_UPLOAD",
          uploadId: "p",
          videoId: "c",
          title: "C",
          uploadType: "publish",
          courseId: "c",
        },
      ],
      [
        0,
        {
          type: "START_UPLOAD",
          uploadId: "u1",
          videoId: "v1",
          title: "V",
          uploadType: "export",
          isBatchEntry: true,
          parentUploadId: "p",
        },
      ],
      [
        1_000,
        {
          type: "UPDATE_VIDEO_UPLOAD_PROGRESS",
          uploadId: "u1",
          uploadedBytes: 0,
          totalBytes: 500,
        },
      ],
      [11_000, { type: "UPLOAD_SUCCESS", uploadId: "u1" }],
    ]);
    expect(state.timings.u1!.completed).toEqual([
      { key: "export:uploading", durationMs: 10_000, units: 500 },
    ]);
  });

  it("does not record a stage cut short by a failure", () => {
    const state = run([
      [0, startExport()],
      [
        0,
        {
          type: "UPDATE_EXPORT_STAGE",
          uploadId: "u1",
          stage: "concatenating-clips",
        },
      ],
      [
        5_000,
        { type: "UPLOAD_FATAL_ERROR", uploadId: "u1", errorMessage: "boom" },
      ],
    ]);
    expect(state.timings.u1!.completed).toEqual([]);
  });

  it("does not record a stage cut short by a retry, and restarts the clock", () => {
    const state = run([
      [0, { type: "START_UPLOAD", uploadId: "u1", videoId: "v1", title: "V" }],
      [5_000, { type: "UPDATE_PROGRESS", uploadId: "u1", progress: 30 }],
      [6_000, { type: "UPLOAD_ERROR", uploadId: "u1", errorMessage: "flaky" }],
      [7_000, { type: "RETRY", uploadId: "u1" }],
    ]);
    expect(state.timings.u1).toMatchObject({
      stage: "upload",
      stageStartedAt: 7_000,
      completed: [],
    });
  });

  it("notes that a Video has an encode to do once an export event names it", () => {
    const state = run([
      [0, startExport()],
      [0, { type: "UPDATE_EXPORT_STAGE", uploadId: "u1", stage: "queued" }],
    ]);
    expect(state.timings.u1!.needsExport).toBe(true);
  });

  it("moves a Publish from its children's work to its own finish when they settle", () => {
    const state = run([
      [
        0,
        {
          type: "START_UPLOAD",
          uploadId: "p",
          videoId: "c",
          title: "C",
          uploadType: "publish",
          courseId: "c",
        },
      ],
      [
        0,
        {
          type: "START_UPLOAD",
          uploadId: "u1",
          videoId: "v1",
          title: "V",
          uploadType: "export",
          isBatchEntry: true,
          parentUploadId: "p",
        },
      ],
      [
        1_000,
        { type: "UPDATE_PUBLISH_STAGE", uploadId: "p", stage: "uploading" },
      ],
      [9_000, { type: "UPLOAD_SUCCESS", uploadId: "u1" }],
    ]);
    expect(state.timings.p).toMatchObject({
      stage: "finalizing",
      stageStartedAt: 9_000,
    });
  });

  it("drops a dismissed job's timing", () => {
    const state = run([
      [0, startExport()],
      [1_000, { type: "DISMISS", uploadId: "u1" }],
    ]);
    expect(state.timings).toEqual({});
  });

  it("records nothing for an action with no clock reading", () => {
    const state = uploadReducer(createInitialUploadState(), startExport());
    expect(state.timings).toEqual({});
  });
});
