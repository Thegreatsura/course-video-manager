import { describe, expect, it, vi } from "vitest";
import { editorSectionsToLoaderSections } from "./use-course-editor";
import {
  courseEditorReducer,
  createInitialCourseEditorState,
} from "@/features/course-editor/course-editor-reducer";
import { EffectQueue } from "@/features/course-editor/effect-queue";
import { ReducerTester } from "@/test-utils/reducer-tester";
import type {
  FrontendId,
  DatabaseId,
  EditorSection,
  EditorLesson,
} from "@/features/course-editor/course-editor-types";
import type { CourseEditorService } from "@/services/course-editor-service";

// ============================================================================
// Helpers
// ============================================================================

const fid = (id: string) => id as FrontendId;
const did = (id: string) => id as DatabaseId;

const createEditorSection = (
  overrides: Partial<EditorSection> = {}
): EditorSection => ({
  frontendId: fid("section-1"),
  databaseId: did("db-section-1"),
  repoVersionId: "version-1",
  path: "test-section",
  description: "",
  order: 1,
  lessons: [],
  ...overrides,
});

const createEditorLesson = (
  overrides: Partial<EditorLesson> = {}
): EditorLesson => ({
  frontendId: fid("lesson-1"),
  databaseId: did("db-lesson-1"),
  sectionId: "section-1",
  path: "test-lesson",
  title: "Test Lesson",
  fsStatus: "real",
  description: "A test lesson",
  icon: "watch",
  priority: 2,
  dependencies: null,
  order: 1,
  videos: [],
  ...overrides,
});

const createMockService = (): CourseEditorService => ({
  createSection: vi
    .fn()
    .mockResolvedValue({ success: true, sectionId: "db-new-section" }),
  updateSectionName: vi.fn().mockResolvedValue({ success: true }),
  updateSectionDescription: vi.fn().mockResolvedValue({ success: true }),
  archiveSection: vi.fn().mockResolvedValue({ success: true }),
  reorderSections: vi.fn().mockResolvedValue({ success: true }),
  addGhostLesson: vi
    .fn()
    .mockResolvedValue({ success: true, lessonId: "db-new-lesson" }),
  createRealLesson: vi.fn().mockResolvedValue({
    success: true,
    lessonId: "db-new-lesson",
    path: "new-lesson",
  }),
  updateLessonName: vi
    .fn()
    .mockResolvedValue({ success: true, path: "new-path" }),
  updateLessonTitle: vi.fn().mockResolvedValue({ success: true }),
  updateLessonDescription: vi.fn().mockResolvedValue({ success: true }),
  updateLessonIcon: vi.fn().mockResolvedValue({ success: true }),
  updateLessonPriority: vi.fn().mockResolvedValue({ success: true }),
  updateLessonDependencies: vi.fn().mockResolvedValue({ success: true }),
  deleteLesson: vi.fn().mockResolvedValue({ success: true }),
  reorderLessons: vi.fn().mockResolvedValue({ success: true }),
  moveLessonToSection: vi.fn().mockResolvedValue({ success: true }),
  convertToGhost: vi.fn().mockResolvedValue({ success: true }),
  createOnDisk: vi
    .fn()
    .mockResolvedValue({ success: true, path: "on-disk-path" }),
});

// ============================================================================
// Tests
// ============================================================================

describe("editorSectionsToLoaderSections", () => {
  it("should convert editor sections back to loader-compatible shape", () => {
    const section = createEditorSection({
      lessons: [
        createEditorLesson({
          videos: [
            {
              id: "video-1",
              path: "intro.mp4",
              clipCount: 3,
              totalDuration: 120,
              firstClipId: "clip-1",
            },
          ],
        }),
      ],
    });

    const result = editorSectionsToLoaderSections([section]);

    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("section-1"); // frontendId becomes id
    expect(result[0]!.path).toBe("test-section");
    expect(result[0]!.lessons).toHaveLength(1);
    expect(result[0]!.lessons[0]!.id).toBe("db-lesson-1"); // databaseId takes precedence over frontendId
    expect(result[0]!.lessons[0]!.title).toBe("Test Lesson");
    expect(result[0]!.lessons[0]!.videos).toHaveLength(1);
    expect(result[0]!.lessons[0]!.videos[0]!.clipCount).toBe(3);
  });

  it("lesson id uses databaseId when available (fix for video upload on new lesson)", () => {
    const section = createEditorSection({
      lessons: [
        createEditorLesson({
          frontendId: fid("frontend-temp-uuid"),
          databaseId: did("db-real-uuid"),
        }),
      ],
    });

    const result = editorSectionsToLoaderSections([section]);

    expect(result[0]!.lessons[0]!.id).toBe("db-real-uuid");
  });

  it("lesson id falls back to frontendId when databaseId is null (lesson not yet saved)", () => {
    const section = createEditorSection({
      lessons: [
        createEditorLesson({
          frontendId: fid("frontend-temp-uuid"),
          databaseId: null as unknown as DatabaseId,
        }),
      ],
    });

    const result = editorSectionsToLoaderSections([section]);

    expect(result[0]!.lessons[0]!.id).toBe("frontend-temp-uuid");
  });

  it("lesson frontendId is stable across databaseId assignment (prevents React key churn on lesson-created)", () => {
    // Before lesson-created fires: optimistic lesson has no databaseId
    const sectionBefore = createEditorSection({
      lessons: [
        createEditorLesson({
          frontendId: fid("frontend-temp-uuid"),
          databaseId: null as unknown as DatabaseId,
        }),
      ],
    });

    const before = editorSectionsToLoaderSections([sectionBefore]);
    const stableKeyBefore = (
      before[0]!.lessons[0]! as unknown as { frontendId: string }
    ).frontendId;

    // After lesson-created fires: databaseId is set
    const sectionAfter = {
      ...sectionBefore,
      lessons: [
        { ...sectionBefore.lessons[0]!, databaseId: did("db-real-uuid") },
      ],
    };

    const after = editorSectionsToLoaderSections([sectionAfter]);
    const stableKeyAfter = (
      after[0]!.lessons[0]! as unknown as { frontendId: string }
    ).frontendId;

    // Stable key must not change — otherwise React unmounts the description textarea
    expect(stableKeyBefore).toBe("frontend-temp-uuid");
    expect(stableKeyAfter).toBe("frontend-temp-uuid");
    expect(stableKeyBefore).toBe(stableKeyAfter);

    // lesson.id still changes (from frontendId to databaseId) for API calls
    expect(before[0]!.lessons[0]!.id).toBe("frontend-temp-uuid");
    expect(after[0]!.lessons[0]!.id).toBe("db-real-uuid");
  });

  it("should handle empty sections", () => {
    const result = editorSectionsToLoaderSections([]);
    expect(result).toEqual([]);
  });
});

describe("useCourseEditor integration (reducer + queue)", () => {
  it("should create section via reducer and queue executes service call", async () => {
    const service = createMockService();
    const dispatched: courseEditorReducer.Action[] = [];

    const queue = new EffectQueue(service, (action) => {
      dispatched.push(action);
    });

    const tester = new ReducerTester(
      courseEditorReducer,
      createInitialCourseEditorState()
    );

    // Simulate what useCourseEditor does: dispatch action, get effect, enqueue it
    const state = tester
      .send({ type: "add-section", title: "New Section", repoVersionId: "v1" })
      .getState();

    expect(state.sections).toHaveLength(1);
    expect(state.sections[0]!.databaseId).toBeNull();

    // Get the effect that was scheduled
    const exec = tester.getExec();
    expect(exec).toHaveBeenCalledTimes(1);
    const effect = (exec as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0]![0] as courseEditorReducer.Effect;
    expect(effect.type).toBe("create-section");

    // Enqueue the effect (this is what the hook's effect handler does)
    queue.enqueue(effect);

    // Wait for async queue processing
    await vi.waitFor(() => {
      expect(service.createSection).toHaveBeenCalledWith(
        "v1",
        "New Section",
        0
      );
    });

    // Queue should have dispatched reconciliation action
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]!.type).toBe("section-created");
  });

  it("should handle sequential create → add lesson with ID resolution", async () => {
    const service = createMockService();
    const dispatched: courseEditorReducer.Action[] = [];

    const queue = new EffectQueue(service, (action) => {
      dispatched.push(action);
    });

    const tester = new ReducerTester(
      courseEditorReducer,
      createInitialCourseEditorState()
    );

    // Create a section
    tester.send({
      type: "add-section",
      title: "New Section",
      repoVersionId: "v1",
    });
    const sectionFrontendId = tester.getState().sections[0]!.frontendId;

    // Get the create-section effect
    const createEffect = (
      tester.getExec() as unknown as ReturnType<typeof vi.fn>
    ).mock.calls[0]![0] as courseEditorReducer.Effect;
    tester.resetExec();

    // Add a lesson to the section (before server confirms section creation)
    tester.send({
      type: "add-ghost-lesson",
      sectionFrontendId,
      title: "New Lesson",
    });

    expect(tester.getState().sections[0]!.lessons).toHaveLength(1);

    // Get the add-ghost-lesson effect
    const addLessonEffect = (
      tester.getExec() as unknown as ReturnType<typeof vi.fn>
    ).mock.calls[0]![0] as courseEditorReducer.Effect;

    // Enqueue both effects — queue processes sequentially
    queue.enqueue(createEffect);
    queue.enqueue(addLessonEffect);

    // Wait for both to complete
    await vi.waitFor(() => {
      expect(service.createSection).toHaveBeenCalledTimes(1);
      expect(service.addGhostLesson).toHaveBeenCalledTimes(1);
    });

    // The lesson's service call should have received the resolved database ID
    // from the section creation, not the frontend ID
    expect(service.addGhostLesson).toHaveBeenCalledWith(
      "db-new-section", // resolved from FrontendId → DatabaseId
      "New Lesson",
      undefined
    );
  });

  it("should process reorder effects", async () => {
    const service = createMockService();
    const dispatched: courseEditorReducer.Action[] = [];

    const queue = new EffectQueue(service, (action) => {
      dispatched.push(action);
    });

    const s1 = createEditorSection({
      frontendId: fid("s1"),
      databaseId: did("db-s1"),
      order: 1,
    });
    const s2 = createEditorSection({
      frontendId: fid("s2"),
      databaseId: did("db-s2"),
      order: 2,
    });

    const tester = new ReducerTester(
      courseEditorReducer,
      createInitialCourseEditorState([s1, s2])
    );

    // Reorder: s2, s1
    tester.send({
      type: "reorder-sections",
      frontendIds: [fid("s2"), fid("s1")],
    });

    const state = tester.getState();
    expect(state.sections[0]!.frontendId).toBe("s2");
    expect(state.sections[1]!.frontendId).toBe("s1");

    // Get the effect
    const effect = (tester.getExec() as unknown as ReturnType<typeof vi.fn>)
      .mock.calls[0]![0] as courseEditorReducer.Effect;
    queue.enqueue(effect);

    await vi.waitFor(() => {
      expect(service.reorderSections).toHaveBeenCalledWith(["db-s2", "db-s1"]);
    });
  });
});
