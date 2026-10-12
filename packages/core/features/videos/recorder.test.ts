import { describe, expect, it } from "vitest";
import { davinciResolveRefusal } from "./recorder.js";

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
