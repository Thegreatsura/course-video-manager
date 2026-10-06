import { describe, it, expect } from "vitest";
import { getAnimaticSection } from "./animatic-instructions";

describe("getAnimaticSection", () => {
  it("returns empty string for no Animatic", () => {
    expect(getAnimaticSection("")).toBe("");
    expect(getAnimaticSection("  \n ")).toBe("");
  });

  it("wraps the Animatic in <animatic> tags under an Animatic heading", () => {
    const result = getAnimaticSection(
      'Mockup 1: "Hi."\n  Comment: Stress this.'
    );
    expect(result).toContain("## Animatic");
    expect(result).toContain("<animatic>");
    expect(result).toContain("  Comment: Stress this.");
    expect(result).toContain("</animatic>");
  });

  it("keeps mockup numbers from being cited as transcript clip indices", () => {
    expect(getAnimaticSection("x")).toContain(
      "Mockup numbers are NOT transcript clip indices"
    );
  });

  it("tells the model to follow a comment about the output, and never quote the Animatic", () => {
    const result = getAnimaticSection("x");
    expect(result).toContain("instruction to follow");
    expect(result).toContain("ever quoted as words said on camera");
  });
});
