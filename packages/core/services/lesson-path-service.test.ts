import { describe, expect, it } from "vitest";
import {
  toSlug,
  deriveLessonPath,
  parseLessonPath,
} from "./lesson-path-service.js";

describe("toSlug", () => {
  it("collapses multiple dashes", () => {
    expect(toSlug("hello---world")).toBe("hello-world");
  });

  it("trims leading and trailing dashes", () => {
    expect(toSlug("-hello-world-")).toBe("hello-world");
  });

  it("handles mixed case with special characters", () => {
    expect(toSlug("What's Up, Doc?")).toBe("whats-up-doc");
  });

  it("strips a slash without leaving a dash", () => {
    expect(toSlug("A/B")).toBe("ab");
  });

  it("gives the same slug to names that differ only by space or dash", () => {
    expect(toSlug("A B")).toBe(toSlug("A-B"));
  });

  it("returns empty string for input with no letters or digits", () => {
    expect(toSlug("///")).toBe("");
  });
});

describe("deriveLessonPath", () => {
  it("derives path from title alone, no ordering number", () => {
    expect(deriveLessonPath("Getting Started")).toBe("getting-started");
  });

  it("falls back to 'untitled' for empty title", () => {
    expect(deriveLessonPath("")).toBe("untitled");
  });
});

describe("parseLessonPath", () => {
  describe("two-digit format (XX.YY-slug)", () => {
    it("parses standard path", () => {
      expect(parseLessonPath("01.03-my-lesson")).toEqual({
        sectionNumber: 1,
        lessonNumber: 3,
        slug: "my-lesson",
      });
    });
  });

  describe("three-digit / legacy format (NNN-slug)", () => {
    it("parses standard 3-digit path", () => {
      expect(parseLessonPath("003-example")).toEqual({
        sectionNumber: undefined,
        lessonNumber: 3,
        slug: "example",
      });
    });

    it("parses path with decimal lesson number", () => {
      expect(parseLessonPath("003.5-extended-example")).toEqual({
        sectionNumber: undefined,
        lessonNumber: 3.5,
        slug: "extended-example",
      });
    });
  });

  describe("invalid paths", () => {
    it("returns null for path without number prefix", () => {
      expect(parseLessonPath("no-number")).toBeNull();
    });

    it("returns null for number-only path (no slug)", () => {
      expect(parseLessonPath("003")).toBeNull();
    });
  });
});
