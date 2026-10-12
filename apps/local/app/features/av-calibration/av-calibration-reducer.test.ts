import { describe, expect, it } from "vitest";
import { createMockExec, ReducerTester } from "@/test-utils/reducer-tester";
import {
  avCalibrationReducer,
  createInitialAVCalibrationState,
} from "./av-calibration-reducer";
import type { CalibrationTimeline } from "./calibration-timeline";
import type { SavedAVCalibration } from "./calibration-wire";

const calibration = (id: string): SavedAVCalibration => ({
  id,
  createdAt: "2026-10-12T09:00:00.000Z",
  outcome: "passed",
  judgement: { outcome: "passed" },
  noiseFloorDb: -80,
  speechLufs: -27,
  truePeakDb: -9,
  thresholdDb: -43,
  recorderMic: "Voicemeeter Out B1",
  browserInputLabel: "Voicemeeter Out B1",
});

const timeline = (calibrationId: string): CalibrationTimeline => ({
  calibrationId,
  rule: { thresholdDb: -43, minSilenceSeconds: 0.8 },
  endSeconds: 63,
  prompts: [],
  reactionMarginSeconds: 0.75,
  browser: null,
  ffmpeg: [],
});

describe("the AV Calibration page's review timeline", () => {
  it("opens a past calibration's result and loads its timeline, ignoring a late one for a calibration it has left", () => {
    const t = new ReducerTester(
      avCalibrationReducer,
      createInitialAVCalibrationState(createMockExec())
    );
    t.send({ type: "past-calibration-clicked", calibration: calibration("a") })
      .send({ type: "past-calibration-clicked", calibration: calibration("b") })
      .send({
        type: "timeline-loaded",
        calibrationId: "a",
        timeline: timeline("a"),
      });
    expect(t.getEffects()).toEqual([
      { type: "load-timeline", calibrationId: "a" },
      { type: "load-timeline", calibrationId: "b" },
    ]);
    expect(t.getState().session).toMatchObject({
      kind: "result",
      calibration: { id: "b" },
      timeline: { status: "loading" },
    });

    t.send({
      type: "timeline-loaded",
      calibrationId: "b",
      timeline: timeline("b"),
    });
    expect(t.getState().session).toMatchObject({
      kind: "result",
      timeline: { status: "loaded", timeline: { calibrationId: "b" } },
    });
  });
});
