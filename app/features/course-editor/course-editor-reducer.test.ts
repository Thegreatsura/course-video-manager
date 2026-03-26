import { describe, expect, it, vi } from "vitest";
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
import { EffectQueue } from "./effect-queue";
import type { CourseEditorService } from "@/services/course-editor-service";

// ============================================================================
// Helpers
// ============================================================================

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

// ============================================================================
// Reducer Tests
// ============================================================================

describe("courseEditorReducer", () => {
  describe("add-section", () => {
    it("should add an optimistic section with a generated frontendId", () => {
      const tester = createTester();

      const state = tester
        .send({ type: "add-section", title: "My Section", repoVersionId: "v1" })
        .getState();

      expect(state.sections).toHaveLength(1);
      expect(state.sections[0]!.path).toBe("My Section");
      expect(state.sections[0]!.databaseId).toBeNull();
      expect(state.sections[0]!.frontendId).toBeTruthy();
      expect(state.sections[0]!.repoVersionId).toBe("v1");
      expect(state.sections[0]!.order).toBe(1);
      expect(state.sections[0]!.lessons).toEqual([]);
    });

    it("should schedule a create-section effect", () => {
      const tester = createTester();

      tester.send({
        type: "add-section",
        title: "My Section",
        repoVersionId: "v1",
      });

      expect(tester.getExec()).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "create-section",
          repoVersionId: "v1",
          title: "My Section",
          maxOrder: 0,
        })
      );
    });

    it("should calculate maxOrder from existing sections", () => {
      const tester = createTester([
        createSection({ order: 3 }),
        createSection({ order: 7 }),
      ]);

      tester.send({
        type: "add-section",
        title: "New Section",
        repoVersionId: "v1",
      });

      const state = tester.getState();
      expect(state.sections).toHaveLength(3);
      expect(state.sections[2]!.order).toBe(8);

      expect(tester.getExec()).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "create-section",
          maxOrder: 7,
        })
      );
    });

    it("should use the raw title as the path (ghost sections keep sentence case)", () => {
      const tester = createTester();

      const state = tester
        .send({
          type: "add-section",
          title: "Hello World!!",
          repoVersionId: "v1",
        })
        .getState();

      expect(state.sections[0]!.path).toBe("Hello World!!");
    });

    it("should use 'untitled' for empty titles", () => {
      const tester = createTester();

      const state = tester
        .send({ type: "add-section", title: "  ", repoVersionId: "v1" })
        .getState();

      expect(state.sections[0]!.path).toBe("untitled");
    });
  });

  describe("rename-section", () => {
    it("should update the section path optimistically with raw title", () => {
      const section = createSection({ path: "Old Name" });
      const tester = createTester([section]);

      const state = tester
        .send({
          type: "rename-section",
          frontendId: section.frontendId,
          title: "New Name",
        })
        .getState();

      expect(state.sections[0]!.path).toBe("New Name");
    });

    it("should schedule a rename-section effect with databaseId", () => {
      const section = createSection({
        databaseId: did("db-123"),
      });
      const tester = createTester([section]);

      tester.send({
        type: "rename-section",
        frontendId: section.frontendId,
        title: "New Name",
      });

      expect(tester.getExec()).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "rename-section",
          sectionId: did("db-123"),
          title: "New Name",
        })
      );
    });

    it("should use frontendId as sectionId when databaseId is null", () => {
      const section = createSection({ databaseId: null });
      const tester = createTester([section]);

      tester.send({
        type: "rename-section",
        frontendId: section.frontendId,
        title: "New Name",
      });

      expect(tester.getExec()).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "rename-section",
          sectionId: section.frontendId,
        })
      );
    });

    it("should not change state for unknown frontendId", () => {
      const section = createSection();
      const tester = createTester([section]);

      const state = tester
        .send({
          type: "rename-section",
          frontendId: fid("unknown"),
          title: "New Name",
        })
        .getState();

      expect(state.sections[0]!.path).toBe(section.path);
    });
  });

  describe("archive-section", () => {
    it("should remove the section optimistically", () => {
      const section = createSection();
      const tester = createTester([section]);

      const state = tester
        .send({ type: "archive-section", frontendId: section.frontendId })
        .getState();

      expect(state.sections).toHaveLength(0);
    });

    it("should schedule an archive-section effect", () => {
      const section = createSection({ databaseId: did("db-456") });
      const tester = createTester([section]);

      tester.send({
        type: "archive-section",
        frontendId: section.frontendId,
      });

      expect(tester.getExec()).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "archive-section",
          sectionId: did("db-456"),
        })
      );
    });

    it("should be a no-op when frontendId does not exist", () => {
      const section = createSection();
      const tester = createTester([section]);

      const state = tester
        .send({ type: "archive-section", frontendId: fid("nonexistent") })
        .getState();

      expect(state.sections).toHaveLength(1);
      expect(tester.getExec()).not.toHaveBeenCalled();
    });

    it("should use frontendId as sectionId when databaseId is null", () => {
      const section = createSection({
        frontendId: fid("frontend-only"),
        databaseId: null as unknown as DatabaseId,
      });
      const tester = createTester([section]);

      tester.send({
        type: "archive-section",
        frontendId: fid("frontend-only"),
      });

      expect(tester.getExec()).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "archive-section",
          sectionId: fid("frontend-only"),
        })
      );
    });

    it("should clear archiveSectionId after archiving", () => {
      const section = createSection();
      const tester = createTester([section]);

      const state = tester
        .send({ type: "set-archive-section-id", sectionId: section.frontendId })
        .send({ type: "archive-section", frontendId: section.frontendId })
        .getState();

      expect(state.sections).toHaveLength(0);
    });
  });

  describe("reorder-sections", () => {
    it("should reorder sections and update order values", () => {
      const s1 = createSection({ order: 1, path: "first" });
      const s2 = createSection({ order: 2, path: "second" });
      const s3 = createSection({ order: 3, path: "third" });
      const tester = createTester([s1, s2, s3]);

      const state = tester
        .send({
          type: "reorder-sections",
          frontendIds: [s3.frontendId, s1.frontendId, s2.frontendId],
        })
        .getState();

      expect(state.sections.map((s) => s.path)).toEqual([
        "third",
        "first",
        "second",
      ]);
      expect(state.sections.map((s) => s.order)).toEqual([1, 2, 3]);
    });

    it("should schedule a reorder-sections effect with resolved IDs", () => {
      const s1 = createSection({
        order: 1,
        databaseId: did("db-1"),
      });
      const s2 = createSection({
        order: 2,
        databaseId: did("db-2"),
      });
      const tester = createTester([s1, s2]);

      tester.send({
        type: "reorder-sections",
        frontendIds: [s2.frontendId, s1.frontendId],
      });

      expect(tester.getExec()).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "reorder-sections",
          sectionIds: [did("db-2"), did("db-1")],
        })
      );
    });
  });

  describe("reconciliation actions", () => {
    it("section-created should populate databaseId and path", () => {
      const tester = createTester();

      tester.send({
        type: "add-section",
        title: "New Section",
        repoVersionId: "v1",
      });

      const frontendId = tester.getState().sections[0]!.frontendId;

      const state = tester
        .send({
          type: "section-created",
          frontendId,
          databaseId: did("db-new"),
          path: "new-section",
        })
        .getState();

      expect(state.sections[0]!.databaseId).toBe("db-new");
      expect(state.sections[0]!.path).toBe("new-section");
    });

    it("section-renamed should update path", () => {
      const section = createSection({ path: "old" });
      const tester = createTester([section]);

      const state = tester
        .send({
          type: "section-renamed",
          frontendId: section.frontendId,
          path: "new-path",
        })
        .getState();

      expect(state.sections[0]!.path).toBe("new-path");
    });

    it("section-archived should not change state", () => {
      const tester = createTester();

      const state = tester
        .send({ type: "section-archived", frontendId: fid("any") })
        .getState();

      expect(state.sections).toHaveLength(0);
    });

    it("sections-reordered should not change state", () => {
      const section = createSection();
      const tester = createTester([section]);

      const state = tester.send({ type: "sections-reordered" }).getState();

      expect(state.sections).toHaveLength(1);
    });
  });

  describe("modal/filter actions (merged from courseViewReducer)", () => {
    it("should toggle boolean modals", () => {
      const tester = createTester();

      const state = tester
        .send({ type: "set-create-section-modal-open", open: true })
        .getState();

      expect(state.isCreateSectionModalOpen).toBe(true);
    });

    it("should handle filter toggles", () => {
      const tester = createTester();

      const state = tester
        .send({ type: "toggle-priority-filter", priority: 1 })
        .send({ type: "toggle-priority-filter", priority: 3 })
        .getState();

      expect(state.priorityFilter).toEqual([1, 3]);
    });

    it("should handle search query", () => {
      const tester = createTester();

      const state = tester
        .send({ type: "set-search-query", query: "hello" })
        .getState();

      expect(state.searchQuery).toBe("hello");
    });

    it("should handle set-add-lesson-section-id with FrontendId", () => {
      const tester = createTester();

      const state = tester
        .send({
          type: "set-add-lesson-section-id",
          sectionId: fid("section-frontend-1"),
        })
        .getState();

      expect(state.addGhostLessonSectionId).toBe("section-frontend-1");
    });
  });
});

// ============================================================================
// EffectQueue Tests
// ============================================================================

describe("EffectQueue", () => {
  const createMockService = (): CourseEditorService => ({
    createSection: vi.fn().mockResolvedValue({
      success: true,
      sectionId: "db-section-new",
    }),
    updateSectionName: vi.fn().mockResolvedValue({ success: true }),
    updateSectionDescription: vi.fn().mockResolvedValue({ success: true }),
    archiveSection: vi.fn().mockResolvedValue({ success: true }),
    reorderSections: vi.fn().mockResolvedValue({ success: true }),
    addGhostLesson: vi
      .fn()
      .mockResolvedValue({ success: true, lessonId: "db-lesson-new" }),
    createRealLesson: vi.fn().mockResolvedValue({
      success: true,
      lessonId: "db-lesson-new",
      path: "mock",
    }),
    updateLessonName: vi
      .fn()
      .mockResolvedValue({ success: true, path: "mock" }),
    updateLessonTitle: vi.fn().mockResolvedValue({ success: true }),
    updateLessonDescription: vi.fn().mockResolvedValue({ success: true }),
    updateLessonIcon: vi.fn().mockResolvedValue({ success: true }),
    updateLessonPriority: vi.fn().mockResolvedValue({ success: true }),
    updateLessonDependencies: vi.fn().mockResolvedValue({ success: true }),
    deleteLesson: vi.fn().mockResolvedValue({ success: true }),
    reorderLessons: vi.fn().mockResolvedValue({ success: true }),
    moveLessonToSection: vi.fn().mockResolvedValue({ success: true }),
    convertToGhost: vi.fn().mockResolvedValue({ success: true }),
    createOnDisk: vi.fn().mockResolvedValue({ success: true, path: "mock" }),
  });

  it("should execute create-section and record ID mapping", async () => {
    const service = createMockService();
    const dispatch = vi.fn();
    const queue = new EffectQueue(service, dispatch);

    queue.enqueue({
      type: "create-section",
      frontendId: fid("frontend-1"),
      repoVersionId: "v1",
      title: "My Section",
      maxOrder: 0,
    });

    // Wait for drain
    await vi.waitFor(() => {
      expect(dispatch).toHaveBeenCalled();
    });

    expect(service.createSection).toHaveBeenCalledWith("v1", "My Section", 0);
    expect(dispatch).toHaveBeenCalledWith({
      type: "section-created",
      frontendId: fid("frontend-1"),
      databaseId: "db-section-new",
      path: "My Section",
    });

    const idMap = queue.getIdMap();
    expect(idMap.get(fid("frontend-1"))).toBe("db-section-new");
  });

  it("should resolve FrontendId to DatabaseId for rename-section", async () => {
    const service = createMockService();
    const dispatch = vi.fn();
    const queue = new EffectQueue(service, dispatch);

    // First create a section
    queue.enqueue({
      type: "create-section",
      frontendId: fid("frontend-1"),
      repoVersionId: "v1",
      title: "Section",
      maxOrder: 0,
    });

    // Then rename it using the frontendId
    queue.enqueue({
      type: "rename-section",
      frontendId: fid("frontend-1"),
      sectionId: fid("frontend-1"),
      title: "Renamed",
    });

    await vi.waitFor(() => {
      expect(dispatch).toHaveBeenCalledTimes(2);
    });

    // rename should have been called with the resolved DatabaseId
    expect(service.updateSectionName).toHaveBeenCalledWith(
      "db-section-new",
      "Renamed"
    );
  });

  it("should resolve FrontendId to DatabaseId for archive-section", async () => {
    const service = createMockService();
    const dispatch = vi.fn();
    const queue = new EffectQueue(service, dispatch);

    queue.enqueue({
      type: "create-section",
      frontendId: fid("frontend-1"),
      repoVersionId: "v1",
      title: "Section",
      maxOrder: 0,
    });

    queue.enqueue({
      type: "archive-section",
      frontendId: fid("frontend-1"),
      sectionId: fid("frontend-1"),
    });

    await vi.waitFor(() => {
      expect(dispatch).toHaveBeenCalledTimes(2);
    });

    expect(service.archiveSection).toHaveBeenCalledWith("db-section-new");
  });

  it("should resolve FrontendIds in reorder-sections", async () => {
    const service = {
      ...createMockService(),
      createSection: vi
        .fn()
        .mockResolvedValueOnce({ success: true, sectionId: "db-1" })
        .mockResolvedValueOnce({ success: true, sectionId: "db-2" }),
    };
    const dispatch = vi.fn();
    const queue = new EffectQueue(service, dispatch);

    queue.enqueue({
      type: "create-section",
      frontendId: fid("f-1"),
      repoVersionId: "v1",
      title: "Section 1",
      maxOrder: 0,
    });

    queue.enqueue({
      type: "create-section",
      frontendId: fid("f-2"),
      repoVersionId: "v1",
      title: "Section 2",
      maxOrder: 1,
    });

    queue.enqueue({
      type: "reorder-sections",
      sectionIds: [fid("f-2"), fid("f-1")],
    });

    await vi.waitFor(() => {
      expect(dispatch).toHaveBeenCalledTimes(3);
    });

    expect(service.reorderSections).toHaveBeenCalledWith(["db-2", "db-1"]);
  });

  it("should execute effects in FIFO order", async () => {
    const executionOrder: string[] = [];
    const service: CourseEditorService = {
      createSection: vi.fn().mockImplementation(async () => {
        executionOrder.push("create");
        return { success: true, sectionId: "db-1" };
      }),
      updateSectionName: vi.fn().mockImplementation(async () => {
        executionOrder.push("rename");
        return { success: true };
      }),
      updateSectionDescription: vi.fn().mockResolvedValue({ success: true }),
      archiveSection: vi.fn().mockImplementation(async () => {
        executionOrder.push("delete");
        return { success: true };
      }),
      reorderSections: vi.fn().mockResolvedValue({ success: true }),
      addGhostLesson: vi
        .fn()
        .mockResolvedValue({ success: true, lessonId: "db-l" }),
      createRealLesson: vi
        .fn()
        .mockResolvedValue({ success: true, lessonId: "db-l", path: "mock" }),
      updateLessonName: vi
        .fn()
        .mockResolvedValue({ success: true, path: "mock" }),
      updateLessonTitle: vi.fn().mockResolvedValue({ success: true }),
      updateLessonDescription: vi.fn().mockResolvedValue({ success: true }),
      updateLessonIcon: vi.fn().mockResolvedValue({ success: true }),
      updateLessonPriority: vi.fn().mockResolvedValue({ success: true }),
      updateLessonDependencies: vi.fn().mockResolvedValue({ success: true }),
      deleteLesson: vi.fn().mockResolvedValue({ success: true }),
      reorderLessons: vi.fn().mockResolvedValue({ success: true }),
      moveLessonToSection: vi.fn().mockResolvedValue({ success: true }),
      convertToGhost: vi.fn().mockResolvedValue({ success: true }),
      createOnDisk: vi.fn().mockResolvedValue({ success: true, path: "mock" }),
    };
    const dispatch = vi.fn();
    const queue = new EffectQueue(service, dispatch);

    queue.enqueue({
      type: "create-section",
      frontendId: fid("f-1"),
      repoVersionId: "v1",
      title: "Section",
      maxOrder: 0,
    });

    queue.enqueue({
      type: "rename-section",
      frontendId: fid("f-1"),
      sectionId: fid("f-1"),
      title: "Renamed",
    });

    queue.enqueue({
      type: "archive-section",
      frontendId: fid("f-1"),
      sectionId: fid("f-1"),
    });

    await vi.waitFor(() => {
      expect(dispatch).toHaveBeenCalledTimes(3);
    });

    expect(executionOrder).toEqual(["create", "rename", "delete"]);
  });

  it("should pass through pre-existing DatabaseIds without resolution", async () => {
    const service = createMockService();
    const dispatch = vi.fn();
    const queue = new EffectQueue(service, dispatch);

    queue.enqueue({
      type: "archive-section",
      frontendId: fid("f-1"),
      sectionId: did("existing-db-id"),
    });

    await vi.waitFor(() => {
      expect(dispatch).toHaveBeenCalled();
    });

    expect(service.archiveSection).toHaveBeenCalledWith("existing-db-id");
  });
});
