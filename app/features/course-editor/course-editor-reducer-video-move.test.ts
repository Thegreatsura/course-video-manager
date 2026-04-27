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
  description: "",
  order: 1,
  lessons: [],
  ...overrides,
});

describe("courseEditorReducer — video-moved", () => {
  it("should move a video from one lesson to another", () => {
    const section = createSection({
      lessons: [
        createLesson({
          databaseId: did("db-lesson-1"),
          videos: [
            {
              id: "video-1",
              path: "video-1.mp4",
              clipCount: 3,
              totalDuration: 120,
              firstClipId: "clip-1",
            },
            {
              id: "video-2",
              path: "video-2.mp4",
              clipCount: 1,
              totalDuration: 60,
              firstClipId: "clip-2",
            },
          ],
        }),
        createLesson({ databaseId: did("db-lesson-2"), order: 2 }),
      ],
    });

    const state = createTester([section])
      .send({
        type: "video-moved",
        videoId: "video-1",
        fromLessonId: "db-lesson-1",
        toLessonId: "db-lesson-2",
      })
      .getState();

    const lesson1 = state.sections[0]!.lessons[0]!;
    const lesson2 = state.sections[0]!.lessons[1]!;

    expect(lesson1.videos).toHaveLength(1);
    expect(lesson1.videos[0]!.id).toBe("video-2");
    expect(lesson2.videos).toHaveLength(1);
    expect(lesson2.videos[0]!.id).toBe("video-1");
    expect(lesson2.videos[0]!.path).toBe("video-1.mp4");
  });

  it("should work across different sections", () => {
    const section1 = createSection({
      lessons: [
        createLesson({
          databaseId: did("db-lesson-1"),
          videos: [
            {
              id: "video-1",
              path: "video-1.mp4",
              clipCount: 3,
              totalDuration: 120,
              firstClipId: "clip-1",
            },
          ],
        }),
      ],
    });
    const section2 = createSection({
      lessons: [createLesson({ databaseId: did("db-lesson-2") })],
    });

    const state = createTester([section1, section2])
      .send({
        type: "video-moved",
        videoId: "video-1",
        fromLessonId: "db-lesson-1",
        toLessonId: "db-lesson-2",
      })
      .getState();

    expect(state.sections[0]!.lessons[0]!.videos).toHaveLength(0);
    expect(state.sections[1]!.lessons[0]!.videos).toHaveLength(1);
    expect(state.sections[1]!.lessons[0]!.videos[0]!.id).toBe("video-1");
  });

  it("should be a no-op when from and to lesson are the same", () => {
    const section = createSection({
      lessons: [
        createLesson({
          databaseId: did("db-lesson-1"),
          videos: [
            {
              id: "video-1",
              path: "video-1.mp4",
              clipCount: 1,
              totalDuration: 60,
              firstClipId: "clip-1",
            },
          ],
        }),
      ],
    });

    const state = createTester([section])
      .send({
        type: "video-moved",
        videoId: "video-1",
        fromLessonId: "db-lesson-1",
        toLessonId: "db-lesson-1",
      })
      .getState();

    expect(state.sections[0]!.lessons[0]!.videos).toHaveLength(1);
    expect(state.sections[0]!.lessons[0]!.videos[0]!.id).toBe("video-1");
  });

  it("should be a no-op when the video is not found", () => {
    const section = createSection({
      lessons: [
        createLesson({
          databaseId: did("db-lesson-1"),
          videos: [
            {
              id: "video-1",
              path: "video-1.mp4",
              clipCount: 1,
              totalDuration: 60,
              firstClipId: "clip-1",
            },
          ],
        }),
        createLesson({ databaseId: did("db-lesson-2"), order: 2 }),
      ],
    });

    const state = createTester([section])
      .send({
        type: "video-moved",
        videoId: "nonexistent",
        fromLessonId: "db-lesson-1",
        toLessonId: "db-lesson-2",
      })
      .getState();

    expect(state.sections[0]!.lessons[0]!.videos).toHaveLength(1);
    expect(state.sections[0]!.lessons[1]!.videos).toHaveLength(0);
  });
});
