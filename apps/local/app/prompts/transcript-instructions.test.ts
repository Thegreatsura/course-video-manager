import { describe, it, expect } from "vitest";
import { getTranscriptSection } from "./transcript-instructions";

describe("getTranscriptSection", () => {
  it("returns empty string for empty transcript", () => {
    expect(getTranscriptSection("")).toBe("");
  });

  it("ends with a trailing newline for composability with other sections", () => {
    const result = getTranscriptSection("[1] Hello world");
    expect(result.endsWith("\n")).toBe(true);
  });
});
