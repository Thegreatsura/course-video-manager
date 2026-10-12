import { describe, expect, it } from "vitest";
import {
  clipRestoreRefusal,
  davinciResolveRefusal,
  isClipRestoreRefusal,
} from "./recorder.js";

describe("davinciResolveRefusal", () => {
  it("refuses a New recorder Video, or any Video holding a new-recorder Clip, and lets OBS through", () => {
    const obsClip = { recordingSessionId: null };
    const newRecorderClip = { recordingSessionId: "rs-1" };

    expect(davinciResolveRefusal({ recorder: "new-recorder", clips: [] })).toBe(
      "Export to DaVinci Resolve works on OBS Videos only: this Video records with the New recorder."
    );
    expect(
      davinciResolveRefusal({
        recorder: null,
        clips: [obsClip, newRecorderClip],
      })
    ).toBe(
      "Export to DaVinci Resolve works on OBS Videos only: this Video holds new-recorder Clips."
    );
    expect(davinciResolveRefusal({ recorder: null, clips: [obsClip] })).toBe(
      null
    );
  });
});

describe("isClipRestoreRefusal", () => {
  it("recognises either Recorder's restore refusal, and nothing else", () => {
    const fromNewRecorder = clipRestoreRefusal("obs", {
      recordingSessionId: "rs-1",
    })!;
    const fromObs = clipRestoreRefusal("new-recorder", {
      recordingSessionId: null,
    })!;

    expect(isClipRestoreRefusal(fromNewRecorder)).toBe(true);
    expect(isClipRestoreRefusal(fromObs)).toBe(true);
    expect(
      isClipRestoreRefusal("ClipService request failed: 500 Internal error")
    ).toBe(false);
  });
});
