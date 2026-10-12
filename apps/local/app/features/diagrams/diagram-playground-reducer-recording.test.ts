import { fromPartial } from "@total-typescript/shoehorn";
import { describe, expect, it } from "vitest";
import { createInitialCvmRecorderState } from "@/features/video-editor/cvm-recorder-reducer";
import { getRecorderCapture } from "@/features/video-editor/recorder-capture";
import { openPage } from "./diagram-playground-reducer-test-helpers";

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
        })
        .send({
          type: "recording-status-reported",
          recording: recording.isRecording,
        })
        .send({ type: "focus-mode-changed", isFocusMode: true })
        // The heartbeat repeats the status mid-take; the author has panned.
        .send({
          type: "recording-status-reported",
          recording: recording.isRecording,
        });

      expect(tester.getState().recording).toBe(true);
      expect(tester.getEffects()).toEqual([
        { type: "set-focus-mode", isFocusMode: true },
        { type: "centre-camera-after-layout" },
      ]);
    }
  );
});
