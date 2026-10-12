import { describe, expect, it } from "vitest";
import {
  deriveThreshold,
  judgeCalibration,
} from "./audio-calibration-constants";

describe("judging an Audio Calibration", () => {
  it("passes inside -27 LUFS ± 2, edges included, with the true peak at or under -6 dBTP", () => {
    expect(judgeCalibration({ speechLufs: -29, truePeakDb: -6 })).toEqual({
      outcome: "passed",
    });
    expect(judgeCalibration({ speechLufs: -25, truePeakDb: -12 })).toEqual({
      outcome: "passed",
    });
  });

  it("fails outside the band, saying which way and by how much", () => {
    expect(judgeCalibration({ speechLufs: -21, truePeakDb: -8 })).toEqual({
      outcome: "failed",
      misses: [{ kind: "too-loud", byDb: 4 }],
    });
    expect(judgeCalibration({ speechLufs: -30.5, truePeakDb: -14 })).toEqual({
      outcome: "failed",
      misses: [{ kind: "too-quiet", byDb: 1.5 }],
    });
  });

  it("fails a take whose true peak is over -6 dBTP, in band or not, with the peak measured", () => {
    expect(judgeCalibration({ speechLufs: -27, truePeakDb: -4.5 })).toEqual({
      outcome: "failed",
      misses: [{ kind: "peak-too-high", truePeakDb: -4.5, byDb: 1.5 }],
    });
    expect(judgeCalibration({ speechLufs: -24, truePeakDb: -5 })).toEqual({
      outcome: "failed",
      misses: [
        { kind: "too-loud", byDb: 1 },
        { kind: "peak-too-high", truePeakDb: -5, byDb: 1 },
      ],
    });
  });

  it("judges a calibration stored before the peak check on loudness alone", () => {
    expect(judgeCalibration({ speechLufs: -27, truePeakDb: null })).toEqual({
      outcome: "passed",
    });
  });

  it("sets the threshold 16 dB under the speech, unclamped across the whole band", () => {
    expect([-29, -27, -25].map(deriveThreshold)).toEqual([-45, -43, -41]);
  });
});
