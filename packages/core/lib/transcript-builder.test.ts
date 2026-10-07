import { describe, it, expect } from "vitest";
import {
  buildTranscript,
  formatOnScreenLinks,
  formatProseTranscript,
  toDiffArray,
  toTranscriptItems,
} from "./transcript-builder.js";
import type { ClipInput, ChapterInput } from "./transcript-builder.js";

const makeClip = (
  order: string,
  text: string | null,
  overrides?: Partial<ClipInput>
): ClipInput => ({
  order,
  text,
  sourceStartTime: 0,
  sourceEndTime: 1,
  videoFilename: "video.mp4",
  ...overrides,
});

const makeSection = (
  id: string,
  order: string,
  name: string
): ChapterInput => ({ id, order, name });

describe("buildTranscript", () => {
  it("returns empty results for empty inputs", () => {
    const result = buildTranscript([], []);
    expect(result.indexedClips).toEqual([]);
    expect(result.transcript).toBe("");
    expect(result.wordCount).toBe(0);
    expect(result.sections).toEqual([]);
  });

  it("produces flat transcript with sequential indices for clips only", () => {
    const clips = [
      makeClip("a0", "Hello world", {
        sourceStartTime: 10.5,
        sourceEndTime: 20.3,
        videoFilename: "recording.webm",
      }),
      makeClip("a1", "Second clip here"),
    ];
    const result = buildTranscript(clips, []);

    expect(result.transcript).toBe("[1] Hello world [2] Second clip here");
    expect(result.indexedClips).toHaveLength(2);
    // Each index maps back to the clip's source footage.
    expect(result.indexedClips[0]).toEqual({
      index: 1,
      sourceStartTime: 10.5,
      sourceEndTime: 20.3,
      videoFilename: "recording.webm",
      text: "Hello world",
    });
    expect(result.indexedClips[1]!.index).toBe(2);
    expect(result.sections).toEqual([]);
  });

  it("produces section headers with zero word counts for sections only", () => {
    const sections = [
      makeSection("s1", "a0", "Intro"),
      makeSection("s2", "a1", "Body"),
    ];
    const result = buildTranscript([], sections);

    expect(result.transcript).toBe("## Intro\n\n## Body");
    expect(result.indexedClips).toEqual([]);
    expect(result.sections).toEqual([
      { id: "s1", name: "Intro", order: "a0", wordCount: 0 },
      { id: "s2", name: "Body", order: "a1", wordCount: 0 },
    ]);
  });

  it("correctly interleaves clips and sections", () => {
    const clips = [
      makeClip("a1", "First clip"),
      makeClip("a3", "Second clip"),
      makeClip("a5", "Third clip"),
    ];
    const sections = [
      makeSection("s1", "a0", "Intro"),
      makeSection("s2", "a2", "Main"),
    ];
    const result = buildTranscript(clips, sections);

    expect(result.transcript).toBe(
      "## Intro\n\n[1] First clip\n\n## Main\n\n[2] Second clip [3] Third clip"
    );
    expect(result.indexedClips).toHaveLength(3);
    expect(result.sections[0]!.wordCount).toBe(2); // "First clip"
    expect(result.sections[1]!.wordCount).toBe(4); // "Second clip" + "Third clip"
  });

  it("includes clips with null text in indexedClips but skips in transcript", () => {
    const clips = [
      makeClip("a0", "Hello"),
      makeClip("a1", null),
      makeClip("a2", "World"),
    ];
    const result = buildTranscript(clips, []);

    expect(result.indexedClips).toHaveLength(3);
    expect(result.indexedClips[0]!.index).toBe(1);
    expect(result.indexedClips[1]!.index).toBe(2);
    expect(result.indexedClips[1]!.text).toBeNull();
    expect(result.indexedClips[2]!.index).toBe(3);
    // Null clip skipped in transcript text
    expect(result.transcript).toBe("[1] Hello [3] World");
  });

  it("handles section at end with no following clips", () => {
    const clips = [makeClip("a0", "Some text")];
    const sections = [makeSection("s1", "a1", "Empty Section")];
    const result = buildTranscript(clips, sections);

    expect(result.transcript).toBe("[1] Some text\n\n## Empty Section");
    expect(result.sections).toEqual([
      { id: "s1", name: "Empty Section", order: "a1", wordCount: 0 },
    ]);
  });

  it("handles clips before the first section correctly", () => {
    const clips = [
      makeClip("a0", "Before section one"),
      makeClip("a1", "Also before section"),
      makeClip("a3", "After section"),
      makeClip("a4", "Also after section"),
    ];
    const sections = [makeSection("s1", "a2", "First Section")];
    const result = buildTranscript(clips, sections);

    expect(result.transcript).toBe(
      "[1] Before section one [2] Also before section\n\n## First Section\n\n[3] After section [4] Also after section"
    );
    expect(result.indexedClips).toHaveLength(4);
    // "After section" (2) + "Also after section" (3) = 5
    expect(result.sections).toEqual([
      { id: "s1", name: "First Section", order: "a2", wordCount: 5 },
    ]);
  });

  it("toTranscriptItems interleaves clips and sections in timeline order", () => {
    const items = toTranscriptItems(
      [
        { order: "a1", text: "First" },
        { order: "a3", text: "Second" },
      ],
      [
        { order: "a0", name: "Intro" },
        { order: "a2", name: "Main" },
      ]
    );

    expect(items).toEqual([
      { type: "section", name: "Intro" },
      { type: "clip", text: "First" },
      { type: "section", name: "Main" },
      { type: "clip", text: "Second" },
    ]);
  });

  it("toTranscriptItems preserves trailing empty sections", () => {
    const items = toTranscriptItems(
      [{ order: "a0", text: "Body" }],
      [{ order: "a1", name: "Trailing" }]
    );

    expect(items).toEqual([
      { type: "clip", text: "Body" },
      { type: "section", name: "Trailing" },
    ]);
  });

  it("toTranscriptItems skips clips with null or empty text", () => {
    const items = toTranscriptItems(
      [
        { order: "a0", text: null },
        { order: "a1", text: "" },
        { order: "a2", text: "Kept" },
      ],
      []
    );

    expect(items).toEqual([{ type: "clip", text: "Kept" }]);
  });

  it("formatProseTranscript renders sections as ## headers between paragraphs", () => {
    const items = toTranscriptItems(
      [
        { order: "a1", text: "First clip" },
        { order: "a3", text: "Second clip" },
      ],
      [{ order: "a2", name: "Main" }]
    );

    expect(formatProseTranscript(items)).toBe(
      "First clip\n\n## Main\n\nSecond clip"
    );
  });

  it("toDiffArray renders sections as ## name strings", () => {
    const items = toTranscriptItems(
      [{ order: "a1", text: "Hello" }],
      [{ order: "a0", name: "Intro" }]
    );

    expect(toDiffArray(items)).toEqual(["## Intro", "Hello"]);
  });
});

describe("formatOnScreenLinks", () => {
  it("renders title and URL, wrapped in the on-screen marker", () => {
    const seen = new Set<string>();
    expect(
      formatOnScreenLinks([{ url: "https://a.com", title: "A Site" }], seen)
    ).toBe("«on screen: A Site — https://a.com» ");
  });

  it("falls back to the bare URL when there is no title", () => {
    const seen = new Set<string>();
    expect(
      formatOnScreenLinks([{ url: "https://a.com", title: null }], seen)
    ).toBe("«on screen: https://a.com» ");
  });

  it("joins multiple fresh links and marks them all seen", () => {
    const seen = new Set<string>();
    expect(
      formatOnScreenLinks(
        [
          { url: "https://a.com", title: "A" },
          { url: "https://b.com", title: null },
        ],
        seen
      )
    ).toBe("«on screen: A — https://a.com; https://b.com» ");
    expect(seen.has("https://a.com")).toBe(true);
    expect(seen.has("https://b.com")).toBe(true);
  });

  it("skips already-seen URLs and returns empty when nothing is fresh", () => {
    const seen = new Set<string>(["https://a.com"]);
    expect(
      formatOnScreenLinks([{ url: "https://a.com", title: "A" }], seen)
    ).toBe("");
  });
});

describe("buildTranscript on-screen web links", () => {
  it("injects the annotation inline after the clip index", () => {
    const { transcript } = buildTranscript(
      [
        makeClip("a0", "So here is the docs page.", {
          webLinks: [{ url: "https://docs.com", title: "Docs" }],
        }),
      ],
      []
    );
    expect(transcript).toBe(
      "[1] «on screen: Docs — https://docs.com» So here is the docs page."
    );
  });

  it("annotates a repeated URL only on its first appearance (global dedup)", () => {
    const { transcript } = buildTranscript(
      [
        makeClip("a0", "First mention.", {
          webLinks: [{ url: "https://docs.com", title: "Docs" }],
        }),
        makeClip("a1", "Second mention.", {
          webLinks: [{ url: "https://docs.com", title: "Docs" }],
        }),
      ],
      []
    );
    expect(transcript).toBe(
      "[1] «on screen: Docs — https://docs.com» First mention. [2] Second mention."
    );
  });
});
