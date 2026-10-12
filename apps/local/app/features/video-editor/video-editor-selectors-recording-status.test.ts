import { describe, expect, it } from "vitest";
import { getShowRecordingSignal } from "./video-editor-selectors";

describe("getShowRecordingSignal", () => {
  it("shows the pulsing signal while a take is under way", () => {
    expect(getShowRecordingSignal(true, false)).toBe(true);
  });

  it("stays hidden when nothing is recording", () => {
    expect(getShowRecordingSignal(false, false)).toBe(false);
  });

  // The reason this selector exists: the glass carries the same status, and a
  // pulsing red circle on the editor is the one thing you can't stop seeing
  // while you read off the prompter.
  it("stays hidden while recording if the teleprompter is connected", () => {
    expect(getShowRecordingSignal(true, true)).toBe(false);
  });

  // A teleprompter attached while OBS is idle must not resurrect the signal
  // when recording later starts — connectedness gates, it doesn't merely
  // toggle.
});
