import { describe, expect, it } from "vitest";
import {
  MAX_RECORDS_PER_STAGE,
  createHistoryStore,
  parseHistory,
  statsFrom,
} from "./upload-history";

describe("stage history", () => {
  it("summarises a stage by its median, so one slow run does not skew it", () => {
    expect(
      statsFrom([
        { durationMs: 10_000, units: null },
        { durationMs: 12_000, units: null },
        { durationMs: 600_000, units: null },
      ])
    ).toEqual({ typicalMs: 12_000, msPerUnit: null, count: 3 });
  });

  it("derives a per-unit rate from the records that carry a size", () => {
    expect(
      statsFrom([
        { durationMs: 10_000, units: 100 },
        { durationMs: 40_000, units: 200 },
        { durationMs: 99_000, units: null },
      ])!.msPerUnit
    ).toBe(150);
  });

  it("keeps only the most recent runs of each stage", () => {
    const store = createHistoryStore({});
    for (let i = 1; i <= MAX_RECORDS_PER_STAGE + 5; i++) {
      store.record("export:uploading", { durationMs: i * 1_000, units: null });
    }
    expect(store.lookup("export:uploading")!.count).toBe(MAX_RECORDS_PER_STAGE);
    expect(store.lookup("export:uploading")!.typicalMs).toBe(15_500);
  });

  it("knows nothing about a stage it has never seen", () => {
    expect(createHistoryStore({}).lookup("render-vertical:compositing")).toBe(
      null
    );
  });

  it("ignores durations that cannot be real", () => {
    const store = createHistoryStore({});
    store.record("youtube:upload", { durationMs: 0, units: null });
    store.record("youtube:upload", { durationMs: Number.NaN, units: null });
    expect(store.lookup("youtube:upload")).toBe(null);
  });

  it("hands every change to its saver, in a form it can read back", () => {
    let saved = "";
    createHistoryStore({}, (data) => {
      saved = JSON.stringify(data);
    }).record("buffer:polling", { durationMs: 8_000, units: null });
    const reloaded = createHistoryStore(parseHistory(saved));
    expect(reloaded.lookup("buffer:polling")!.typicalMs).toBe(8_000);
  });

  it("survives storage it cannot parse", () => {
    expect(parseHistory(null)).toEqual({});
    expect(parseHistory("{not json")).toEqual({});
    expect(
      parseHistory(JSON.stringify({ a: "nope", b: [{ durationMs: -1 }] }))
    ).toEqual({});
  });
});
