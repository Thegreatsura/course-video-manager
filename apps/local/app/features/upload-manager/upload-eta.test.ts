import { describe, expect, it } from "vitest";
import { createHistoryStore, type HistoryData } from "./upload-history";
import { etaLabel, formatRemaining, jobEta } from "./upload-eta";
import type { TimedRows } from "./upload-timing";
import {
  exportProgress,
  exportStage,
  progress,
  renderStage,
  replay,
  start,
  succeed,
  videoUploadProgress,
  type RowStep,
} from "./upload-timing-test-setup";

const run = replay;

const runs = (durationMs: number, count = 3, units: number | null = null) =>
  Array.from({ length: count }, () => ({ durationMs, units }));

/** The ETA of job `u1` at `now`, given the stage history `past`. */
const etaOf = (state: TimedRows, now: number, past: HistoryData = {}) =>
  jobEta(state.uploads.u1!, state.timings.u1, {
    timings: state.timings,
    history: createHistoryStore(past).lookup,
    now,
  });

const youtube = start("u1", "youtube");
const progressTo = (value: number) => progress("u1", value);

describe("jobEta from the live rate", () => {
  it("is estimating until it has seen enough time", () => {
    const state = run([
      [0, youtube],
      [2_000, progressTo(10)],
    ]);
    expect(etaOf(state, 2_000)).toEqual({ kind: "estimating" });
  });

  it("is estimating until it has seen enough progress", () => {
    const state = run([
      [0, youtube],
      [5_000, progressTo(1)],
    ]);
    expect(etaOf(state, 5_000)).toEqual({ kind: "estimating" });
  });

  it("projects the rest of the job at the recent rate", () => {
    // 1% a second, 10% done: 90s to go.
    const state = run([
      [0, youtube],
      [5_000, progressTo(5)],
      [10_000, progressTo(10)],
    ]);
    expect(etaOf(state, 10_000)).toEqual({
      kind: "remaining",
      ms: 90_000,
      scope: "job",
    });
  });

  it("counts down between progress events", () => {
    const state = run([
      [0, youtube],
      [10_000, progressTo(10)],
    ]);
    expect(etaOf(state, 15_000)).toMatchObject({ ms: 85_000 });
  });

  it("does not jump on one burst of progress", () => {
    const steady = run(
      Array.from({ length: 21 }, (_, i): RowStep =>
        i === 0 ? [0, youtube] : [i * 1_000, progressTo(i)]
      )
    );
    const burst = run([[21_000, progressTo(26)]], steady);
    const before = etaOf(steady, 20_000);
    const after = etaOf(burst, 21_000);
    if (before.kind !== "remaining" || after.kind !== "remaining") {
      throw new Error("expected estimates");
    }
    // The last second alone ran at 6%/s — 12s left. The window keeps it
    // near the steady rate.
    expect(after.ms).toBeGreaterThan(50_000);
    expect(after.ms).toBeLessThan(before.ms);
  });

  it("goes back to estimating rather than below zero when overdue", () => {
    const state = run([
      [0, youtube],
      [10_000, progressTo(50)],
    ]);
    expect(etaOf(state, 10_000)).toMatchObject({ ms: 10_000 });
    expect(etaOf(state, 25_000)).toEqual({ kind: "estimating" });
  });

  it("has nothing to say about a finished or failed job", () => {
    const done = run([
      [0, youtube],
      [1_000, succeed("u1")],
    ]);
    expect(etaOf(done, 2_000)).toEqual({ kind: "none" });
  });
});

describe("jobEta from history", () => {
  it("estimates a stage that streams no percentage from its past runs", () => {
    const state = run([
      [0, start("u1", "render-vertical")],
      [0, renderStage("u1", "compositing")],
    ]);
    expect(
      etaOf(state, 20_000, { "render-vertical:compositing": runs(60_000) })
    ).toEqual({
      kind: "remaining",
      ms: 40_000,
      scope: "job",
    });
  });

  it("says nothing for such a stage without history", () => {
    const state = run([[0, start("u1", "render-vertical")]]);
    expect(etaOf(state, 5_000)).toEqual({ kind: "none" });
  });

  it("adds the stages still to come to the whole job", () => {
    const state = run([
      [0, start("u1", "render-vertical")],
      [0, renderStage("u1", "transcribing")],
    ]);
    const past = {
      "render-vertical:transcribing": runs(30_000),
      "render-vertical:rendering-overlay": runs(60_000),
      "render-vertical:compositing": runs(90_000),
    };
    expect(etaOf(state, 10_000, past)).toEqual({
      kind: "remaining",
      ms: 20_000 + 60_000 + 90_000,
      scope: "job",
    });
  });

  it("estimates only the current stage when a later one has no history", () => {
    const state = run([
      [0, start("u1", "export")],
      [0, exportStage("u1", "concatenating-clips")],
      [5_000, exportProgress("u1", "concatenating-clips", 10)],
    ]);
    expect(etaOf(state, 5_000)).toMatchObject({ scope: "stage", ms: 45_000 });
  });

  it("trusts history early and the live rate once it has seen more", () => {
    const past = { "youtube:upload": runs(200_000) };
    // Live says 1%/s. History says the job takes 200s.
    const early = run([
      [0, youtube],
      [3_000, progressTo(3)],
    ]);
    const late = run([
      [0, youtube],
      [30_000, progressTo(30)],
    ]);
    const earlyEta = etaOf(early, 3_000, past);
    const lateEta = etaOf(late, 30_000, past);
    // Early: mostly history (~194s), live alone would say 97s.
    expect(earlyEta).toMatchObject({ kind: "remaining" });
    expect(earlyEta.kind === "remaining" && earlyEta.ms).toBeGreaterThan(
      150_000
    );
    // Late: all live.
    expect(lateEta).toEqual({ kind: "remaining", ms: 70_000, scope: "job" });
  });

  it("scales an upload by its size when past uploads recorded theirs", () => {
    const state = run([
      [0, start("p", "publish")],
      [0, start("u1", "export", { isBatchEntry: true, parentUploadId: "p" })],
      [0, videoUploadProgress("u1", 0, 1_000)],
    ]);
    // 10ms a byte: a 1,000-byte Video is a 10s upload.
    expect(
      etaOf(state, 1_000, { "export:uploading": runs(5_000, 3, 500) })
    ).toEqual({
      kind: "remaining",
      ms: 9_000,
      scope: "job",
    });
  });
});

describe("formatting", () => {
  it.each([
    [3_000, "<10s"],
    [42_000, "~45s"],
    [58_000, "~1m"],
    [185_000, "~3m"],
    [3_600_000, "~1h"],
    [3_900_000, "~1h 5m"],
  ])("formats %ims as %s", (ms, text) => {
    expect(formatRemaining(ms)).toBe(text);
  });

  it("labels whether it is the job or the stage", () => {
    expect(etaLabel({ kind: "remaining", ms: 180_000, scope: "job" })).toBe(
      "~3m left"
    );
    expect(etaLabel({ kind: "remaining", ms: 180_000, scope: "stage" })).toBe(
      "~3m left in stage"
    );
    expect(etaLabel({ kind: "estimating" })).toBe("estimating…");
    expect(etaLabel({ kind: "none" })).toBe(null);
  });
});
