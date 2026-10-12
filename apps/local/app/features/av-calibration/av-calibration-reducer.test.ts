import { describe, expect, it } from "vitest";
import { createMockExec, ReducerTester } from "@/test-utils/reducer-tester";
import {
  CLOSE_OBS_TO_CALIBRATE,
  SCRIPT_END_SECONDS,
  SCRIPT_SCHEDULE,
} from "@/av-calibration-constants";
import {
  avCalibrationReducer,
  createInitialAVCalibrationState,
  currentStep,
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
  cameraDevice: "Cam Link 4K",
  clapsFound: 5,
  clapSpreadMs: 8,
  micOffsetMs: 142,
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

describe("the AV Calibration page's session", () => {
  const reading = (seconds: number) => ({
    type: "meter-reading" as const,
    seconds,
    momentaryLufs: -30,
    shortTermLufs: -30,
    receivedAtMs: 1_000 + seconds * 1000,
  });

  it("prompts 5 claps between the silence and the reading, on the files' clock from where the run went live, and sends the clap window to the analysis", () => {
    const t = new ReducerTester(
      avCalibrationReducer,
      createInitialAVCalibrationState(createMockExec())
    );
    t.send({ type: "meter-started", mic: "Voicemeeter Out B1" })
      .send({ type: "start-clicked" })
      .send({
        type: "calibration-started",
        calibrationId: "run-1",
        mic: "Voicemeeter Out B1",
        // The camera took 4.2 s to open: the files' clock began before it.
        scriptStartSeconds: 4.2,
      });

    const stepAtFile = (fileSeconds: number) => {
      t.send(reading(fileSeconds));
      return currentStep(t.getState())?.step;
    };
    expect(stepAtFile(4.3)).toMatchObject({ kind: "countdown" });
    expect(stepAtFile(4.2 + 14)).toMatchObject({ kind: "clap-ready" });
    const claps = SCRIPT_SCHEDULE.filter((s) => s.kind === "clap");
    claps.forEach((clap, i) =>
      expect(stepAtFile(4.2 + clap.startSeconds + 0.1)).toEqual({
        kind: "clap",
        clap: i + 1,
        startSeconds: clap.startSeconds,
        endSeconds: clap.endSeconds,
      })
    );
    expect(stepAtFile(4.2 + claps.at(-1)!.endSeconds + 0.1)).toMatchObject({
      kind: "read",
      line: 1,
    });

    t.send(reading(4.2 + SCRIPT_END_SECONDS));
    const finish = t.getEffects().find((e) => e.type === "finish-calibration");
    expect(finish).toMatchObject({
      calibrationId: "run-1",
      scriptStartSeconds: 4.2,
    });
    if (finish?.type !== "finish-calibration") throw new Error("no finish");
    const { windows } = finish;
    expect(windows.claps.startSeconds).toBeCloseTo(4.2 + 13, 6);
    expect(windows.claps.endSeconds).toBeCloseTo(
      4.2 + claps.at(-1)!.endSeconds + 0.75,
      6
    );
    expect(windows.silence.endSeconds).toBeLessThanOrEqual(
      windows.claps.startSeconds
    );
    expect(windows.speech[0]!.startSeconds).toBeGreaterThanOrEqual(
      windows.claps.endSeconds
    );
  });

  it("says Close OBS to calibrate when another program holds the Cam Link, starts nothing, and starts once it is freed, without a reload", () => {
    const t = new ReducerTester(
      avCalibrationReducer,
      createInitialAVCalibrationState(createMockExec())
    );
    t.send({ type: "meter-started", mic: "Voicemeeter Out B1" })
      .send({ type: "start-clicked" })
      .send({ type: "start-refused", message: CLOSE_OBS_TO_CALIBRATE });
    expect(t.getState().session).toEqual({ kind: "camera-busy" });
    expect(t.getState().browser.capture).toBeNull();
    // Nothing ran, so nothing is measured or stored.
    expect(t.getEffects().map((e) => e.type)).toEqual([
      "start-calibration",
      "capture-browser-levels",
    ]);

    // Matt closes OBS and presses Start again.
    t.resetExec().send({ type: "start-clicked" }).send({
      type: "calibration-started",
      calibrationId: "run-1",
      mic: "Voicemeeter Out B1",
      scriptStartSeconds: 3.1,
    });
    expect(t.getEffects().map((e) => e.type)).toEqual([
      "start-calibration",
      "capture-browser-levels",
    ]);
    expect(t.getState().session).toMatchObject({
      kind: "running",
      calibrationId: "run-1",
    });
  });

  it("shows any other refused Start, such as a Cam Link that opens and sends nothing, as the session stopping", () => {
    const t = new ReducerTester(
      avCalibrationReducer,
      createInitialAVCalibrationState(createMockExec())
    );
    const notStarting =
      "Cam Link not starting: unplug and replug it, then press Retry.";
    t.send({ type: "meter-started", mic: "Voicemeeter Out B1" })
      .send({ type: "start-clicked" })
      .send({ type: "start-refused", message: notStarting });
    expect(t.getState().session).toEqual({
      kind: "failed",
      message: notStarting,
    });
  });
});
