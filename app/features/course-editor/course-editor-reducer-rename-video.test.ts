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
} from "./course-editor-types";

const createTester = (sections: EditorSection[] = []) =>
  new ReducerTester(
    courseEditorReducer,
    createInitialCourseEditorState(sections)
  );

const fid = (id: string) => id as FrontendId;
const did = (id: string) => id as DatabaseId;

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

describe("courseEditorReducer — rename-video-optimistic", () => {
  it("should update video path in sections and close rename modal", () => {
    const section = createSection({
      lessons: [
        {
          frontendId: fid("lesson-1"),
          databaseId: did("db-lesson-1"),
          sectionId: "section-1",
          path: "lesson-1",
          title: "Lesson 1",
          fsStatus: "real",
          description: "",
          icon: null,
          priority: 2,
          dependencies: null,
          order: 1,
          videos: [
            {
              id: "vid-1",
              path: "old-name.mp4",
              clipCount: 2,
              totalDuration: 120,
              firstClipId: "clip-1",
            },
          ],
        },
      ],
    });
    const tester = createTester([section]);

    const state = tester
      .send({
        type: "open-rename-video",
        videoId: "vid-1",
        videoPath: "old-name.mp4",
      })
      .send({
        type: "rename-video-optimistic",
        videoId: "vid-1",
        newName: "new-name.mp4",
      })
      .getState();

    expect(state.sections[0]!.lessons[0]!.videos[0]!.path).toBe("new-name.mp4");
    expect(state.renameVideoState).toBeNull();
  });

  it("should not change video path when video ID is not found", () => {
    const section = createSection({
      lessons: [
        {
          frontendId: fid("lesson-1"),
          databaseId: did("db-lesson-1"),
          sectionId: "section-1",
          path: "lesson-1",
          title: "Lesson 1",
          fsStatus: "real",
          description: "",
          icon: null,
          priority: 2,
          dependencies: null,
          order: 1,
          videos: [
            {
              id: "vid-1",
              path: "old-name.mp4",
              clipCount: 2,
              totalDuration: 120,
              firstClipId: "clip-1",
            },
          ],
        },
      ],
    });
    const tester = createTester([section]);

    const state = tester
      .send({
        type: "rename-video-optimistic",
        videoId: "nonexistent",
        newName: "new-name.mp4",
      })
      .getState();

    expect(state.sections[0]!.lessons[0]!.videos[0]!.path).toBe("old-name.mp4");
    expect(state.renameVideoState).toBeNull();
  });

  it("should find video across multiple sections and lessons", () => {
    const section1 = createSection({
      order: 1,
      lessons: [
        {
          frontendId: fid("lesson-1"),
          databaseId: did("db-lesson-1"),
          sectionId: "section-1",
          path: "lesson-1",
          title: "",
          fsStatus: "real",
          description: "",
          icon: null,
          priority: 2,
          dependencies: null,
          order: 1,
          videos: [],
        },
      ],
    });
    const section2 = createSection({
      order: 2,
      lessons: [
        {
          frontendId: fid("lesson-2"),
          databaseId: did("db-lesson-2"),
          sectionId: "section-2",
          path: "lesson-2",
          title: "",
          fsStatus: "real",
          description: "",
          icon: null,
          priority: 2,
          dependencies: null,
          order: 1,
          videos: [
            {
              id: "vid-deep",
              path: "deep-video.mp4",
              clipCount: 1,
              totalDuration: 60,
              firstClipId: null,
            },
          ],
        },
      ],
    });
    const tester = createTester([section1, section2]);

    const state = tester
      .send({
        type: "rename-video-optimistic",
        videoId: "vid-deep",
        newName: "renamed-deep.mp4",
      })
      .getState();

    expect(state.sections[1]!.lessons[0]!.videos[0]!.path).toBe(
      "renamed-deep.mp4"
    );
  });
});
