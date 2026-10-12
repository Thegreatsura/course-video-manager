import { describe, expect, it } from "vitest";
import { parseVideoRecorder, resolveVideoRecorder } from "./recorder.js";

describe("reading a stored Recorder", () => {
  it("reads the CVM recorder's pre-rename value `new-recorder` as `cvm`", () => {
    expect(parseVideoRecorder("new-recorder")).toBe("cvm");
    expect(
      resolveVideoRecorder({ format: "landscape", recorder: "new-recorder" })
    ).toBe("cvm");
  });

  it("reads `obs` and `cvm` as themselves, and anything else as no Recorder", () => {
    expect(parseVideoRecorder("obs")).toBe("obs");
    expect(parseVideoRecorder("cvm")).toBe("cvm");
    expect(parseVideoRecorder(null)).toBeNull();
    expect(parseVideoRecorder("something")).toBeNull();
    expect(resolveVideoRecorder({ format: "landscape", recorder: null })).toBe(
      "obs"
    );
  });

  it("reads every Short as the CVM recorder, whatever it stored", () => {
    expect(resolveVideoRecorder({ format: "short", recorder: "obs" })).toBe(
      "cvm"
    );
    expect(resolveVideoRecorder({ format: "short", recorder: null })).toBe(
      "cvm"
    );
  });
});
