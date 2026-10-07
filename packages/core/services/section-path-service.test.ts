import { describe, expect, it } from "vitest";
import { deriveSectionPath, parseSectionPath } from "./section-path-service.js";

describe("deriveSectionPath", () => {
  it("derives path from title alone, no ordering number", () => {
    expect(deriveSectionPath("Introduction")).toBe("introduction");
  });

  it("falls back to 'untitled' for empty title", () => {
    expect(deriveSectionPath("")).toBe("untitled");
  });
});

describe("parseSectionPath", () => {
  it("parses standard path", () => {
    expect(parseSectionPath("01-intro")).toEqual({
      sectionNumber: 1,
      slug: "intro",
    });
    expect(parseSectionPath("12-getting-started-with-ts")).toEqual({
      sectionNumber: 12,
      slug: "getting-started-with-ts",
    });
  });

  it("returns null for path without number prefix", () => {
    expect(parseSectionPath("no-number")).toBeNull();
  });

  it("returns null for number-only path (no slug)", () => {
    expect(parseSectionPath("03")).toBeNull();
  });
});
