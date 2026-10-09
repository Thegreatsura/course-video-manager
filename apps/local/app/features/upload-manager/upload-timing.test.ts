import { describe, expect, it } from "vitest";
import { SAMPLE_WINDOW_MS } from "./upload-timing";
import {
  dismiss,
  exportProgress,
  exportStage,
  fail,
  publishStage,
  replay,
  start,
  succeed,
  videoUploadProgress,
  type RowStep,
} from "./upload-timing-test-setup";

const startExport = (uploadId = "u1") => start(uploadId, "export");

/** A Publish `p` with one Video `u1` under it. */
const publishWithOneVideo = (): RowStep[] => [
  [0, start("p", "publish")],
  [0, start("u1", "export", { isBatchEntry: true, parentUploadId: "p" })],
];

describe("upload timings", () => {
  it("starts timing a job at the moment it starts", () => {
    const state = replay([[1_000, startExport()]]);
    expect(state.timings.u1).toMatchObject({
      stage: "queued",
      stageStartedAt: 1_000,
      samples: [{ at: 1_000, progress: 0 }],
      completed: [],
    });
  });

  it("samples the bar as it moves", () => {
    const state = replay([
      [0, startExport()],
      [1_000, exportStage("u1", "concatenating-clips")],
      [2_000, exportProgress("u1", "concatenating-clips", 10)],
      [3_000, exportProgress("u1", "concatenating-clips", 20)],
    ]);
    expect(state.timings.u1!.samples).toEqual([
      { at: 1_000, progress: 0 },
      { at: 2_000, progress: 8 },
      { at: 3_000, progress: 16 },
    ]);
  });

  it("keeps only the recent window of samples", () => {
    const steps: RowStep[] = [
      [0, startExport()],
      [0, exportStage("u1", "concatenating-clips")],
    ];
    for (let percent = 1; percent <= 60; percent++) {
      steps.push([
        percent * 1_000,
        exportProgress("u1", "concatenating-clips", percent),
      ]);
    }
    const samples = replay(steps).timings.u1!.samples;
    expect(samples[0]!.at).toBeGreaterThanOrEqual(60_000 - SAMPLE_WINDOW_MS);
    expect(samples[samples.length - 1]!.at).toBe(60_000);
  });

  it("records a work stage's duration when the job moves on", () => {
    const state = replay([
      [0, startExport()],
      [1_000, exportStage("u1", "concatenating-clips")],
      [61_000, exportStage("u1", "normalizing-audio")],
      [71_000, succeed("u1")],
    ]);
    // The queue is a wait, not a duration worth remembering.
    expect(state.timings.u1!.completed).toEqual([
      { key: "export:concatenating-clips", durationMs: 60_000, units: null },
      { key: "export:normalizing-audio", durationMs: 10_000, units: null },
    ]);
    expect(state.timings.u1!).toMatchObject({ stage: null, endedAt: 71_000 });
  });

  it("records an upload's size alongside its duration", () => {
    const state = replay([
      ...publishWithOneVideo(),
      [1_000, videoUploadProgress("u1", 0, 500)],
      [11_000, succeed("u1")],
    ]);
    expect(state.timings.u1!.completed).toEqual([
      { key: "export:uploading", durationMs: 10_000, units: 500 },
    ]);
  });

  it("does not record a stage cut short by a failure", () => {
    const state = replay([
      [0, startExport()],
      [0, exportStage("u1", "concatenating-clips")],
      [5_000, fail("u1")],
    ]);
    expect(state.timings.u1!.completed).toEqual([]);
  });

  it("notes that a Video has an encode to do once an export event names it", () => {
    const state = replay([
      [0, startExport()],
      [0, exportStage("u1", "queued")],
    ]);
    expect(state.timings.u1!.needsExport).toBe(true);
  });

  it("moves a Publish from its children's work to its own finish when they settle", () => {
    const state = replay([
      ...publishWithOneVideo(),
      [1_000, publishStage("p", "uploading")],
      [9_000, succeed("u1")],
    ]);
    expect(state.timings.p).toMatchObject({
      stage: "finalizing",
      stageStartedAt: 9_000,
    });
  });

  it("drops a dismissed job's timing", () => {
    const state = replay([
      [0, startExport()],
      [1_000, dismiss("u1")],
    ]);
    expect(state.timings).toEqual({});
  });

  it("records nothing for a step with no clock reading", () => {
    const state = replay([[undefined, startExport()]]);
    expect(state.timings).toEqual({});
  });
});
