import { describe, expect, it } from "vitest";
import { micOffsetColumn } from "./mic-offset-column";

describe("Past calibrations' Mic Offset column", () => {
  it("shows each Mic Offset with its change from the previous row that has one, and — without one", () => {
    expect(
      micOffsetColumn([
        { micOffsetMs: 161.6 },
        { micOffsetMs: null },
        { micOffsetMs: 150 },
        { micOffsetMs: 158.2 },
        { micOffsetMs: 158 },
        { micOffsetMs: null },
      ])
    ).toEqual([
      "162 ms (+12)",
      "—",
      "150 ms (-8)",
      "158 ms (±0)",
      "158 ms",
      "—",
    ]);
  });
});
