import { describe, it, expect } from "vitest";
import {
  buildLessonNavigateTo,
  buildLessonRenameEvent,
} from "./lesson-title-editor";

// ---------------------------------------------------------------------------
// buildLessonNavigateTo — Section Workbench click-to-rename (issue #1100)
// ---------------------------------------------------------------------------

describe("buildLessonNavigateTo", () => {
  const courseId = "course-1";
  const sectionId = "section-1";
  const lessonId = "lesson-1";

  it("returns a Section Workbench link in non-compact (course) view", () => {
    const result = buildLessonNavigateTo({
      compact: false,
      courseId,
      sectionId,
      lessonId,
    });
    expect(result).toBe(
      `/courses/${courseId}/sections/${sectionId}#${lessonId}`
    );
  });

  it("returns undefined in compact (Section Workbench) view so click-to-rename activates", () => {
    const result = buildLessonNavigateTo({
      compact: true,
      courseId,
      sectionId,
      lessonId,
    });
    expect(result).toBeUndefined();
  });

  it("returns undefined when courseId is missing", () => {
    const result = buildLessonNavigateTo({
      compact: false,
      courseId: undefined,
      sectionId,
      lessonId,
    });
    expect(result).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// buildLessonRenameEvent — the title save guard
// ---------------------------------------------------------------------------

describe("buildLessonRenameEvent", () => {
  const lesson = { id: "lesson-1", title: "Old Title", path: "old-title" };

  it("renames to the trimmed value, keeping the user's casing", () => {
    expect(
      buildLessonRenameEvent({ value: "  gRPC in Practice ", lesson })
    ).toEqual({
      type: "update-lesson-title",
      lessonId: "lesson-1",
      title: "gRPC in Practice",
    });
  });

  it("saves nothing when the value only differs by surrounding whitespace", () => {
    expect(
      buildLessonRenameEvent({ value: "  Old Title  ", lesson })
    ).toBeNull();
  });

  it("saves nothing for a blank value", () => {
    expect(buildLessonRenameEvent({ value: "   ", lesson })).toBeNull();
  });

  it("compares against the path when the lesson has no title", () => {
    const untitled = { ...lesson, title: "" };
    expect(
      buildLessonRenameEvent({ value: "old-title", lesson: untitled })
    ).toBeNull();
  });
});
