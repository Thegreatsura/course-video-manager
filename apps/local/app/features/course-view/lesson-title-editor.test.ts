import { describe, it, expect } from "vitest";
import { buildLessonNavigateTo } from "./lesson-title-editor";

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
