import { fromPartial } from "@total-typescript/shoehorn";
import { describe, expect, it } from "vitest";
import { createInitialCvmRecorderState } from "@/features/video-editor/cvm-recorder-reducer";
import { getRecorderCapture } from "@/features/video-editor/recorder-capture";
import {
  loaded,
  openPage,
  scene,
  shown,
} from "./diagram-playground-reducer-test-helpers";

const notRecording = {
  obsState: fromPartial<Parameters<typeof getRecorderCapture>[0]["obsState"]>({
    type: "obs-connected",
  }),
  obsSpeech: { type: "silence" as const },
  cvmRecorder: createInitialCvmRecorderState(),
};

// What the Video Editor pushes to the playground is the shared Recorder
// Capture's `isRecording`, so a take on either Recorder reaches it the same way.
const recorders = [
  {
    name: "OBS",
    idle: getRecorderCapture({ usesObs: true, ...notRecording }),
    recording: getRecorderCapture({
      usesObs: true,
      ...notRecording,
      obsState: fromPartial({ type: "obs-recording" }),
    }),
  },
  {
    name: "the CVM recorder",
    idle: getRecorderCapture({ usesObs: false, ...notRecording }),
    recording: getRecorderCapture({
      usesObs: false,
      ...notRecording,
      cvmRecorder: { ...notRecording.cvmRecorder, phase: "recording" },
    }),
  },
];

describe("a take starting on either Recorder", () => {
  it.each(recorders)(
    "closes the sidebar and centres the diagram once on $name",
    ({ idle, recording }) => {
      const tester = openPage()
        .resetExec()
        .send({
          type: "recording-status-reported",
          recording: idle.isRecording,
          format: "landscape",
        })
        .send({
          type: "recording-status-reported",
          recording: recording.isRecording,
          format: "landscape",
        })
        .send({ type: "focus-mode-changed", isFocusMode: true })
        // The heartbeat repeats the status mid-take; the author has panned.
        .send({
          type: "recording-status-reported",
          recording: recording.isRecording,
          format: "landscape",
        });

      expect(tester.getState().recording).toBe(true);
      expect(tester.getEffects()).toEqual([
        { type: "set-focus-mode", isFocusMode: true },
        { type: "centre-camera-after-layout", format: "landscape" },
      ]);
    }
  );
});

describe("a take starting on a Short", () => {
  it("centres for the Short's format", () => {
    const tester = openPage().resetExec().send({
      type: "recording-status-reported",
      recording: true,
      format: "short",
    });

    expect(tester.getEffects()).toEqual([
      { type: "set-focus-mode", isFocusMode: true },
      { type: "centre-camera-after-layout", format: "short" },
    ]);
  });
});

describe("the playground's Video is a Short, outside a take", () => {
  // The video editor reports its Video's format on every heartbeat, recording
  // or not, so every centring uses it — not just a take starting.
  const onAShort = () =>
    openPage().send({
      type: "recording-status-reported",
      recording: false,
      format: "short",
    });

  it("centres a loaded scene for the Short", () => {
    const tester = onAShort()
      .resetExec()
      .send({ type: "diagram-opened", diagramId: "d1" })
      .send(loaded("d1", scene("d1")));

    expect(tester.getEffects()).toContainEqual(
      shown("d1", scene("d1"), { format: "short" })
    );
  });

  it("recentres for the Short when asked", () => {
    const tester = onAShort().resetExec().send({ type: "recentre-requested" });

    expect(tester.getEffects()).toEqual([
      { type: "centre-camera-after-layout", format: "short" },
    ]);
  });

  it("recentres for Landscape until the video editor says otherwise", () => {
    const tester = openPage().resetExec().send({ type: "recentre-requested" });

    expect(tester.getEffects()).toEqual([
      { type: "centre-camera-after-layout", format: "landscape" },
    ]);
  });
});
