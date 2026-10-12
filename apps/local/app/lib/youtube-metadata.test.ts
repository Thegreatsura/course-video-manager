import { describe, expect, it } from "vitest";
import { findYouTubeMetadataProblem } from "./youtube-metadata";

describe("findYouTubeMetadataProblem", () => {
  it("names what YouTube would refuse, and passes what it accepts", () => {
    const ok = "A fine description";
    const check = (title: string, description = ok) =>
      findYouTubeMetadataProblem({ title, description })?.message ?? null;

    expect(check("AI Psychosis -> Software Fundamentals Cycle")).toBe(
      'YouTube title can\'t contain ">" (YouTube refuses < and >)'
    );
    expect(check("a < b")).toBe(
      'YouTube title can\'t contain "<" (YouTube refuses < and >)'
    );
    expect(check("   ")).toBe("YouTube title can't be empty");
    expect(check("Candidate 1\nCandidate 2")).toBe(
      "YouTube title must be a single line"
    );
    expect(check("x".repeat(101))).toBe(
      "YouTube title is 101 characters; YouTube allows at most 100"
    );
    expect(check("x".repeat(100))).toBeNull();
    expect(check("🚀".repeat(100))).toBeNull();
    expect(check("Title here\n")).toBeNull();
    expect(check("Title", "use <div>")).toBe(
      'YouTube description can\'t contain "<" (YouTube refuses < and >)'
    );
    expect(check("Title", "é".repeat(2501))).toBe(
      "YouTube description is 5002 bytes; YouTube allows at most 5000"
    );
    expect(check("Title", "x".repeat(5000))).toBeNull();
  });
});
