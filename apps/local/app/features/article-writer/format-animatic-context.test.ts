import { describe, it, expect } from "vitest";
import { formatAnimaticContext } from "./format-animatic-context";

describe("formatAnimaticContext", () => {
  it("returns empty string when the Video has no Animatic", () => {
    expect(formatAnimaticContext([])).toBe("");
  });

  it("lists every Clip Mockup line under its chapter, numbered as the Animatic page numbers them", () => {
    const result = formatAnimaticContext([
      { type: "chapter", id: "c1", name: "Setup", comments: [] },
      {
        type: "clip-mockup",
        id: "m1",
        line: "Hi.",
        comments: [],
        position: 1,
      },
      {
        type: "clip-mockup",
        id: "m2",
        line: "Here's the problem.",
        comments: [],
        position: 2,
      },
    ]);
    expect(result).toBe(
      [
        "Chapter: Setup",
        'Mockup 1: "Hi."',
        'Mockup 2: "Here\'s the problem."',
      ].join("\n")
    );
  });

  it("files each comment under the line or chapter it hangs off, in the order given", () => {
    const result = formatAnimaticContext([
      {
        type: "chapter",
        id: "c1",
        name: "Setup",
        comments: ["Name the repo here."],
      },
      {
        type: "clip-mockup",
        id: "m3",
        line: "Here's the problem.",
        comments: ["Stress this in the article.", "Say it slower."],
        position: 3,
      },
    ]);
    expect(result).toBe(
      [
        "Chapter: Setup",
        "  Comment: Name the repo here.",
        'Mockup 3: "Here\'s the problem."',
        "  Comment: Stress this in the article.",
        "  Comment: Say it slower.",
      ].join("\n")
    );
  });

  it("indents the later lines of a multi-line comment", () => {
    const result = formatAnimaticContext([
      {
        type: "clip-mockup",
        id: "m1",
        line: "Hi.",
        comments: ["Line one\nLine two"],
        position: 1,
      },
    ]);
    expect(result).toBe('Mockup 1: "Hi."\n  Comment: Line one\n    Line two');
  });
});
