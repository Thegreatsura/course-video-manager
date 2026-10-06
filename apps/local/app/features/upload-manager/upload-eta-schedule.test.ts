import { describe, expect, it } from "vitest";
import { createInitialUploadState, uploadReducer } from "./upload-reducer";
import { createHistoryStore, type HistoryData } from "./upload-history";
import { allDoneEta, estimateUploads } from "./upload-eta-schedule";

type Step = [number, uploadReducer.Action];

const run = (steps: Step[]) =>
  steps.reduce(
    (state, [at, action]) => uploadReducer(state, { ...action, at }),
    createInitialUploadState()
  );

const runs = (durationMs: number) =>
  Array.from({ length: 3 }, () => ({ durationMs, units: null }));

const estimate = (state: uploadReducer.State, now: number, past: HistoryData) =>
  estimateUploads(state.uploads, {
    timings: state.timings,
    history: createHistoryStore(past).lookup,
    now,
  });

const msOf = (eta: unknown) =>
  (eta as { kind: string; ms?: number }).kind === "remaining"
    ? (eta as { ms: number }).ms
    : eta;

/** A Publish fanned out into `count` Videos, each with an encode to do. */
const publishOf = (count: number, { exported = false } = {}): Step[] => {
  const steps: Step[] = [
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
  ];
  for (let i = 1; i <= count; i++) {
    steps.push([
      0,
      {
        type: "START_UPLOAD",
        uploadId: `v${i}`,
        videoId: `v${i}`,
        title: `V${i}`,
        uploadType: "export",
        isBatchEntry: true,
        parentUploadId: "p",
      },
    ]);
  }
  steps.push([
    0,
    { type: "UPDATE_PUBLISH_STAGE", uploadId: "p", stage: "uploading" },
  ]);
  if (!exported) {
    for (let i = 1; i <= count; i++) {
      steps.push([
        0,
        { type: "UPDATE_EXPORT_STAGE", uploadId: `v${i}`, stage: "queued" },
      ]);
    }
  }
  return steps;
};

// An encode is 60s (50 + 10), an upload 20s, the commit 30s.
const publishHistory: HistoryData = {
  "export:concatenating-clips": runs(50_000),
  "export:normalizing-audio": runs(10_000),
  "export:uploading": runs(20_000),
  "publish:finalizing": runs(30_000),
};

describe("a Publish's estimate", () => {
  it("replays its encodes six at a time and its uploads four at a time", () => {
    // 8 Videos: encodes finish at 60s (×6) and 120s (×2). Upload slots go in
    // roster order and wait on each Video's encode: v1–v4 upload 60→80s,
    // v5–v6 80→100s, v7–v8 wait for their encode then upload 120→140s.
    const etas = estimate(run(publishOf(8)), 0, publishHistory);
    expect(msOf(etas.v1)).toBe(80_000);
    expect(msOf(etas.v5)).toBe(100_000);
    expect(msOf(etas.v8)).toBe(140_000);
    expect(etas.p).toEqual({
      kind: "remaining",
      ms: 140_000 + 30_000,
      scope: "job",
    });
  });

  it("does not wait on an encode for a Video already on disk", () => {
    const etas = estimate(
      run(publishOf(4, { exported: true })),
      0,
      publishHistory
    );
    expect(msOf(etas.v4)).toBe(20_000);
  });

  it("credits work a child has already done", () => {
    const state = run([
      ...publishOf(1),
      [
        0,
        {
          type: "UPDATE_EXPORT_STAGE",
          uploadId: "v1",
          stage: "concatenating-clips",
        },
      ],
      [
        40_000,
        {
          type: "UPDATE_EXPORT_STAGE",
          uploadId: "v1",
          stage: "normalizing-audio",
        },
      ],
    ]);
    // 10s of normalizing, then a 20s upload.
    expect(msOf(estimate(state, 40_000, publishHistory).v1)).toBe(30_000);
  });

  it("says how long its children's part takes when the commit has no history", () => {
    const { "publish:finalizing": _, ...noCommit } = publishHistory;
    expect(estimate(run(publishOf(2)), 0, noCommit).p).toEqual({
      kind: "remaining",
      ms: 80_000,
      scope: "stage",
    });
  });

  it("is estimating while its Videos have no history and no signal", () => {
    expect(estimate(run(publishOf(2)), 0, {}).p).toEqual({
      kind: "estimating",
    });
  });

  it("estimates only its current stage before its Videos are known", () => {
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
      [0, { type: "UPDATE_PUBLISH_STAGE", uploadId: "p", stage: "validating" }],
    ]);
    expect(
      estimate(state, 1_000, { "publish:validating": runs(5_000) }).p
    ).toEqual({
      kind: "remaining",
      ms: 4_000,
      scope: "stage",
    });
  });
});

describe("an Autofill's estimate", () => {
  const autofillOf = (count: number): Step[] => [
    [
      0,
      {
        type: "START_UPLOAD",
        uploadId: "a",
        videoId: "c",
        title: "C",
        uploadType: "autofill",
        courseId: "c",
      },
    ],
    [0, { type: "UPDATE_AUTOFILL_STAGE", uploadId: "a", stage: "writing" }],
    ...Array.from({ length: count }, (_, i): Step => [
      0,
      {
        type: "START_UPLOAD",
        uploadId: `w${i + 1}`,
        videoId: `w${i + 1}`,
        title: "W",
        uploadType: "autofill",
        parentUploadId: "a",
      },
    ]),
  ];

  it("runs its Videos six at a time, counting those not started yet", () => {
    // 13 Videos of 10s: three rounds.
    const etas = estimate(run(autofillOf(13)), 0, {
      "autofill-video:writing": runs(10_000),
    });
    expect(etas.a).toEqual({ kind: "remaining", ms: 30_000, scope: "job" });
    expect(msOf(etas.w13)).toBe(30_000);
  });
});

describe("Export All", () => {
  it("queues its Videos behind the six-way encode pool", () => {
    const steps: Step[] = Array.from({ length: 7 }, (_, i): Step => [
      0,
      {
        type: "START_UPLOAD",
        uploadId: `e${i + 1}`,
        videoId: `e${i + 1}`,
        title: "E",
        uploadType: "export",
        isBatchEntry: true,
      },
    ]);
    const state = run(steps);
    const etas = estimate(state, 0, publishHistory);
    expect(msOf(etas.e1)).toBe(60_000);
    expect(msOf(etas.e7)).toBe(120_000);
    expect(allDoneEta(state.uploads, etas)).toBe(120_000);
  });
});

describe("allDoneEta", () => {
  it("is unknown while any top-level job has no whole-job estimate", () => {
    const state = run([
      [
        0,
        {
          type: "START_UPLOAD",
          uploadId: "e1",
          videoId: "e1",
          title: "E",
          uploadType: "export",
        },
      ],
      [
        0,
        {
          type: "START_UPLOAD",
          uploadId: "r1",
          videoId: "r1",
          title: "R",
          uploadType: "render-vertical",
        },
      ],
    ]);
    expect(allDoneEta(state.uploads, estimate(state, 0, publishHistory))).toBe(
      null
    );
  });
});
