import { describe, expect, it } from "vitest";
import {
  CALIBRATION_VALIDITY_MS,
  calibrationValidity,
  deriveThreshold,
  judgeCalibration,
  passesCurrentRules,
  type CurrentInputDevice,
  type LastPassedCalibration,
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

const AT = Date.UTC(2026, 9, 12, 9);
const MIC = "Voicemeeter Out B1 (VB-Audio Voicemeeter VAIO)";
const lastPassed: LastPassedCalibration = {
  id: "c1",
  createdAtMs: AT,
  thresholdDb: -43,
  recorderMic: MIC,
  browserInputLabel: MIC,
};

describe("whether a Recorder may start (the gate)", () => {
  it.each<
    [string, LastPassedCalibration | null, CurrentInputDevice, number, unknown]
  >([
    ["none yet", null, {}, AT, { kind: "none" }],
    ["a minute old", lastPassed, { recorderMic: MIC }, AT + 60_000, null],
    [
      "a millisecond under 7 days",
      lastPassed,
      { browserInputLabel: MIC },
      AT + CALIBRATION_VALIDITY_MS - 1,
      null,
    ],
    [
      "exactly 7 days old",
      lastPassed,
      {},
      AT + CALIBRATION_VALIDITY_MS,
      { kind: "expired", expiredAtMs: AT + CALIBRATION_VALIDITY_MS },
    ],
    [
      "the recorder's mic changed",
      lastPassed,
      { recorderMic: "Scarlett Solo USB" },
      AT,
      {
        kind: "device-changed",
        device: "recorder-mic",
        from: MIC,
        to: "Scarlett Solo USB",
      },
    ],
    [
      "the browser has no mic open",
      lastPassed,
      { browserInputLabel: null },
      AT,
      { kind: "device-changed", device: "browser-input", from: MIC, to: null },
    ],
  ])("%s", (_, last, device, now, reason) => {
    const validity = calibrationValidity(last, device, now);
    expect(validity).toEqual(
      reason === null
        ? {
            valid: true,
            calibration: last,
            expiresAtMs: AT + CALIBRATION_VALIDITY_MS,
          }
        : { valid: false, reason }
    );
  });

  it("counts only a pass under today's rules: not an old -21 LUFS pass, nor one with no peak measured", () => {
    const pass = {
      outcome: "passed" as const,
      speechLufs: -27,
      truePeakDb: -9,
    };
    expect(passesCurrentRules(pass)).toBe(true);
    expect(passesCurrentRules({ ...pass, speechLufs: -21 })).toBe(false);
    expect(passesCurrentRules({ ...pass, truePeakDb: null })).toBe(false);
    expect(passesCurrentRules({ ...pass, outcome: "failed" })).toBe(false);
  });
});
