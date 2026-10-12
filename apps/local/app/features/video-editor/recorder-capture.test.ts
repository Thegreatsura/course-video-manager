import { fromPartial } from "@total-typescript/shoehorn";
import { describe, expect, it } from "vitest";
import { createInitialNewRecorderState } from "./new-recorder-reducer";
import { getRecorderCapture, toCaptureStatus } from "./recorder-capture";

describe("the capture the editor and the glass show", () => {
  const newRecorderSpeaking = {
    ...createInitialNewRecorderState(),
    phase: "recording" as const,
    speech: { type: "speaking-detected" as const },
  };

  it("is OBS's recording state and browser speech detector on an OBS Video", () => {
    const capture = getRecorderCapture({
      usesObs: true,
      obsState: fromPartial({ type: "obs-recording" }),
      obsSpeech: { type: "silence" },
      newRecorder: newRecorderSpeaking,
    });
    expect(toCaptureStatus(capture)).toBe("silence");
    expect(
      toCaptureStatus(
        getRecorderCapture({
          usesObs: true,
          obsState: { type: "obs-not-running" },
          obsSpeech: { type: "silence" },
          newRecorder: newRecorderSpeaking,
        })
      )
    ).toBe("not-recording");
  });

  it("is the New recorder's on a New recorder Video, whatever OBS says", () => {
    const capture = getRecorderCapture({
      usesObs: false,
      obsState: { type: "obs-not-running" },
      obsSpeech: { type: "silence" },
      newRecorder: newRecorderSpeaking,
    });
    expect(capture.isRecording).toBe(true);
    expect(toCaptureStatus(capture)).toBe("speaking-detected");
  });
});
