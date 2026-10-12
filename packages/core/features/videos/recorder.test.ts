import { describe, expect, it } from "vitest";
import {
  clipRestoreRefusal,
  davinciResolveRefusal,
  isClipRestoreRefusal,
  parseVideoRecorder,
  resolveVideoRecorder,
} from "./recorder.js";

describe("reading a stored Recorder", () => {
  it("reads the CVM recorder's pre-rename value `new-recorder` as `cvm`", () => {
    expect(parseVideoRecorder("new-recorder")).toBe("cvm");
    expect(resolveVideoRecorder("new-recorder")).toBe("cvm");
  });

  it("reads `obs` and `cvm` as themselves, and anything else as no Recorder", () => {
    expect(parseVideoRecorder("obs")).toBe("obs");
    expect(parseVideoRecorder("cvm")).toBe("cvm");
    expect(parseVideoRecorder(null)).toBeNull();
    expect(parseVideoRecorder("something")).toBeNull();
    expect(resolveVideoRecorder(null)).toBe("obs");
  });
});

describe("davinciResolveRefusal", () => {
  it("refuses a CVM recorder Video, or any Video holding a CVM-recorder Clip, and lets OBS through", () => {
    const obsClip = { recordingSessionId: null };
    const cvmRecorderClip = { recordingSessionId: "rs-1" };

    expect(davinciResolveRefusal({ recorder: "cvm", clips: [] })).toBe(
      "Export to DaVinci Resolve works on OBS Videos only: this Video records with the CVM recorder."
    );
    expect(
      davinciResolveRefusal({
        recorder: null,
        clips: [obsClip, cvmRecorderClip],
      })
    ).toBe(
      "Export to DaVinci Resolve works on OBS Videos only: this Video holds CVM-recorder Clips."
    );
    expect(davinciResolveRefusal({ recorder: null, clips: [obsClip] })).toBe(
      null
    );
  });
});

describe("isClipRestoreRefusal", () => {
  it("recognises either Recorder's restore refusal, and nothing else", () => {
    const fromCvmRecorder = clipRestoreRefusal("obs", {
      recordingSessionId: "rs-1",
    })!;
    const fromObs = clipRestoreRefusal("cvm", {
      recordingSessionId: null,
    })!;

    expect(isClipRestoreRefusal(fromCvmRecorder)).toBe(true);
    expect(isClipRestoreRefusal(fromObs)).toBe(true);
    expect(
      isClipRestoreRefusal("ClipService request failed: 500 Internal error")
    ).toBe(false);
  });
});
