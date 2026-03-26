import { describe, expect, it } from "vitest";
import {
  courseEditorReducer,
  createInitialCourseEditorState,
} from "./course-editor-reducer";
import { ReducerTester } from "@/test-utils/reducer-tester";
import type {
  FrontendId,
  DatabaseId,
  EditorSection,
  EditorLesson,
} from "./course-editor-types";

const createTester = (sections: EditorSection[] = []) =>
  new ReducerTester(
    courseEditorReducer,
    createInitialCourseEditorState(sections)
  );

const fid = (id: string) => id as FrontendId;
const did = (id: string) => id as DatabaseId;

const createLesson = (overrides: Partial<EditorLesson> = {}): EditorLesson => ({
  frontendId: fid(crypto.randomUUID()),
  databaseId: did(crypto.randomUUID()),
  sectionId: "section-1",
  path: "test-lesson",
  title: "Test Lesson",
  fsStatus: "real",
  description: "",
  icon: null,
  priority: 2,
  dependencies: null,
  order: 1,
  videos: [],
  ...overrides,
});

const createSection = (
  overrides: Partial<EditorSection> = {}
): EditorSection => ({
  frontendId: fid(crypto.randomUUID()),
  databaseId: did(crypto.randomUUID()),
  repoVersionId: "version-1",
  path: "test-section",
  order: 1,
  lessons: [],
  ...overrides,
});

describe("courseEditorReducer — editing optimistic lessons by databaseId", () => {
  // After an optimistically created lesson gets its databaseId from the backend,
  // editorSectionsToLoaderSections exposes id = (databaseId ?? frontendId).
  // Once databaseId is set, components dispatch with frontendId: lesson.id = databaseId.
  // The reducer must still find and update the lesson.

  it("update-lesson-description should work when dispatched with databaseId as frontendId", () => {
    const lesson = createLesson({
      frontendId: fid("frontend-uuid"),
      databaseId: did("db-id"),
      description: "",
    });
    const section = createSection({ lessons: [lesson] });
    const state = createTester([section])
      .send({
        type: "update-lesson-description",
        frontendId: did("db-id") as unknown as FrontendId,
        description: "New description",
      })
      .getState();
    expect(state.sections[0]!.lessons[0]!.description).toBe("New description");
  });

  it("update-lesson-title should work when dispatched with databaseId as frontendId", () => {
    const lesson = createLesson({
      frontendId: fid("frontend-uuid"),
      databaseId: did("db-id"),
      title: "Old Title",
    });
    const section = createSection({ lessons: [lesson] });
    const state = createTester([section])
      .send({
        type: "update-lesson-title",
        frontendId: did("db-id") as unknown as FrontendId,
        title: "New Title",
      })
      .getState();
    expect(state.sections[0]!.lessons[0]!.title).toBe("New Title");
  });

  it("delete-lesson should work when dispatched with databaseId as frontendId", () => {
    const lesson = createLesson({
      frontendId: fid("frontend-uuid"),
      databaseId: did("db-id"),
    });
    const section = createSection({ lessons: [lesson] });
    const state = createTester([section])
      .send({
        type: "delete-lesson",
        frontendId: did("db-id") as unknown as FrontendId,
      })
      .getState();
    expect(state.sections[0]!.lessons).toHaveLength(0);
  });

  it("lesson-name-updated reconciliation should work when frontendId is databaseId", () => {
    const lesson = createLesson({
      frontendId: fid("frontend-uuid"),
      databaseId: did("db-id"),
      path: "old-path",
    });
    const section = createSection({ lessons: [lesson] });
    const state = createTester([section])
      .send({
        type: "lesson-name-updated",
        frontendId: did("db-id") as unknown as FrontendId,
        path: "new-path",
      })
      .getState();
    expect(state.sections[0]!.lessons[0]!.path).toBe("new-path");
  });

  it("reorder-lessons should work when lessonFrontendIds contain databaseIds", () => {
    const lesson1 = createLesson({
      frontendId: fid("fe-1"),
      databaseId: did("db-1"),
      order: 1,
    });
    const lesson2 = createLesson({
      frontendId: fid("fe-2"),
      databaseId: did("db-2"),
      order: 2,
    });
    const section = createSection({
      frontendId: fid("section-fe"),
      lessons: [lesson1, lesson2],
    });
    // Dispatch reorder with databaseIds (as components would after lesson-created)
    const state = createTester([section])
      .send({
        type: "reorder-lessons",
        sectionFrontendId: fid("section-fe"),
        lessonFrontendIds: [
          did("db-2") as unknown as FrontendId,
          did("db-1") as unknown as FrontendId,
        ],
      })
      .getState();
    expect(state.sections[0]!.lessons[0]!.frontendId).toBe("fe-2");
    expect(state.sections[0]!.lessons[1]!.frontendId).toBe("fe-1");
  });

  it("create-real-lesson with adjacentLessonId as databaseId should insert at correct position", () => {
    const existing = createLesson({
      frontendId: fid("fe-existing"),
      databaseId: did("db-existing"),
      order: 1,
      path: "01-01-existing",
    });
    const section = createSection({
      frontendId: fid("section-fe"),
      path: "01-section",
      lessons: [existing],
    });
    const state = createTester([section])
      .send({
        type: "create-real-lesson",
        sectionFrontendId: fid("section-fe"),
        title: "New Lesson",
        adjacentLessonId: did("db-existing") as unknown as FrontendId,
        position: "before" as const,
      })
      .getState();
    // New lesson should be inserted before the existing one
    expect(state.sections[0]!.lessons).toHaveLength(2);
    expect(state.sections[0]!.lessons[0]!.title).toBe("New Lesson");
    expect(state.sections[0]!.lessons[1]!.frontendId).toBe("fe-existing");
  });

  it("delete-lesson with databaseId should only delete the matched lesson, not others", () => {
    const lesson1 = createLesson({
      frontendId: fid("fe-1"),
      databaseId: did("db-1"),
    });
    const lesson2 = createLesson({
      frontendId: fid("fe-2"),
      databaseId: did("db-2"),
    });
    const section = createSection({ lessons: [lesson1, lesson2] });
    const state = createTester([section])
      .send({
        type: "delete-lesson",
        frontendId: did("db-1") as unknown as FrontendId,
      })
      .getState();
    expect(state.sections[0]!.lessons).toHaveLength(1);
    expect(state.sections[0]!.lessons[0]!.frontendId).toBe("fe-2");
  });

  it("operations should still work with frontendId when databaseId is null", () => {
    const lesson = createLesson({
      frontendId: fid("fe-only"),
      databaseId: null,
      description: "",
    });
    const section = createSection({ lessons: [lesson] });
    const state = createTester([section])
      .send({
        type: "update-lesson-description",
        frontendId: fid("fe-only"),
        description: "Works with null databaseId",
      })
      .getState();
    expect(state.sections[0]!.lessons[0]!.description).toBe(
      "Works with null databaseId"
    );
  });
});
