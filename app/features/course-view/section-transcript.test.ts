import { describe, it, expect } from "vitest";
import {
  buildSectionTranscript,
  buildCourseTranscript,
  type TranscriptOptions,
} from "./section-transcript";
import type { Lesson, Section } from "./course-view-types";

const makeLesson = (overrides: Partial<Lesson> = {}): Lesson =>
  ({
    id: "lesson-1",
    path: "01.01-intro",
    title: "Intro",
    description: "Lesson desc",
    priority: 1,
    icon: "watch",
    videos: [],
    ...overrides,
  }) as unknown as Lesson;

const makeSection = (overrides: Partial<Section> = {}): Section =>
  ({
    id: "section-1",
    path: "01-basics",
    description: "Section desc",
    lessons: [makeLesson()],
    ...overrides,
  }) as unknown as Section;

const baseOptions: TranscriptOptions = {
  includeTranscripts: false,
  includeLessonDescriptions: false,
  includeLessonTitles: false,
  includePriority: false,
  includeExerciseType: false,
  includeSectionDescription: false,
};

describe("buildSectionTranscript", () => {
  it("1. does not include section description by default", () => {
    const result = buildSectionTranscript(
      "01-basics",
      [makeLesson()],
      { ...baseOptions },
      {}
    );
    expect(result).not.toContain("<description>");
    expect(result).not.toContain("Section desc");
  });

  it("2. includes section description when includeSectionDescription is true", () => {
    const result = buildSectionTranscript(
      "01-basics",
      [makeLesson()],
      { ...baseOptions, includeSectionDescription: true },
      {},
      "Section desc"
    );
    expect(result).toContain("<description>Section desc</description>");
  });

  it("3. does not include section description when option is true but description is empty", () => {
    const result = buildSectionTranscript(
      "01-basics",
      [makeLesson()],
      { ...baseOptions, includeSectionDescription: true },
      {},
      ""
    );
    expect(result).not.toContain("<description>");
  });

  it("3b. does not include section description when option is true but description is undefined", () => {
    const result = buildSectionTranscript(
      "01-basics",
      [makeLesson()],
      { ...baseOptions, includeSectionDescription: true },
      {},
      undefined
    );
    expect(result).not.toContain("<description>");
  });

  it("4. escapes special characters in section description", () => {
    const result = buildSectionTranscript(
      "01-basics",
      [makeLesson()],
      { ...baseOptions, includeSectionDescription: true },
      {},
      'Desc with <tag> & "quotes"'
    );
    expect(result).toContain(
      "<description>Desc with &lt;tag&gt; &amp; &quot;quotes&quot;</description>"
    );
  });
});

describe("buildCourseTranscript", () => {
  it("5. includes section descriptions when includeSectionDescription is true", () => {
    const section = makeSection({ description: "My section desc" });
    const result = buildCourseTranscript(
      "my-course",
      [section],
      { ...baseOptions, includeSectionDescription: true },
      {}
    );
    expect(result).toContain("<description>My section desc</description>");
  });

  it("6. does not include section descriptions when includeSectionDescription is false", () => {
    const section = makeSection({ description: "My section desc" });
    const result = buildCourseTranscript(
      "my-course",
      [section],
      { ...baseOptions, includeSectionDescription: false },
      {}
    );
    expect(result).not.toContain("My section desc");
  });

  it("7. handles section with null description in course mode", () => {
    const section = makeSection({ description: null as unknown as string });
    const result = buildCourseTranscript(
      "my-course",
      [section],
      { ...baseOptions, includeSectionDescription: true },
      {}
    );
    expect(result).not.toContain("<description>");
  });

  it("8. includes descriptions only for sections that have them", () => {
    const sectionWithDesc = makeSection({
      path: "01-with-desc",
      description: "Has description",
    });
    const sectionWithoutDesc = makeSection({
      path: "02-no-desc",
      description: null as unknown as string,
    });
    const result = buildCourseTranscript(
      "my-course",
      [sectionWithDesc, sectionWithoutDesc],
      { ...baseOptions, includeSectionDescription: true },
      {}
    );
    expect(result).toContain("<description>Has description</description>");
    // The second section should not have a description tag
    const descriptionCount = (result.match(/<description>/g) || []).length;
    expect(descriptionCount).toBe(1);
  });
});
