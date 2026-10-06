import { describe, it, expect } from "vitest";
import { getScriptSection } from "./script-instructions";

describe("getScriptSection", () => {
  it("returns empty string for a whitespace-only script", () => {
    expect(getScriptSection("   \n  ")).toBe("");
  });

  it("ends with a trailing newline for composability with other sections", () => {
    const result = getScriptSection("some script");
    expect(result.endsWith("\n")).toBe(true);
  });
});
