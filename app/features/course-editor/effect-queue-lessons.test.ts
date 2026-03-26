import { describe, expect, it, vi } from "vitest";
import type { FrontendId, DatabaseId } from "./course-editor-types";
import { EffectQueue } from "./effect-queue";
import type { CourseEditorService } from "@/services/course-editor-service";

const fid = (id: string) => id as FrontendId;
const did = (id: string) => id as DatabaseId;

const createMockService = (): CourseEditorService => ({
  createSection: vi
    .fn()
    .mockResolvedValue({ success: true, sectionId: "db-section-new" }),
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
    path: "new-lesson",
  }),
  updateLessonName: vi
    .fn()
    .mockResolvedValue({ success: true, path: "renamed-lesson" }),
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

describe("EffectQueue — throttled effects (coalescing)", () => {
  it("should coalesce multiple update-lesson-priority effects for the same lesson, only calling service once with final value", async () => {
    // Simulate slow service so the first effect is in-flight while others queue up
    let resolveFirst!: () => void;
    const firstCallPromise = new Promise<void>((res) => {
      resolveFirst = res;
    });
    const service = {
      ...createMockService(),
      updateLessonPriority: vi
        .fn()
        .mockImplementationOnce(() =>
          firstCallPromise.then(() => ({ success: true }))
        )
        .mockResolvedValue({ success: true }),
    };
    const dispatch = vi.fn();
    const queue = new EffectQueue(service, dispatch);

    // Enqueue first effect — this starts processing immediately (in-flight)
    queue.enqueue({
      type: "update-lesson-priority",
      frontendId: fid("l-1"),
      lessonId: did("db-l-1"),
      priority: 3,
    });

    // Enqueue two more while first is still in-flight
    queue.enqueue({
      type: "update-lesson-priority",
      frontendId: fid("l-1"),
      lessonId: did("db-l-1"),
      priority: 1,
    });
    queue.enqueue({
      type: "update-lesson-priority",
      frontendId: fid("l-1"),
      lessonId: did("db-l-1"),
      priority: 2,
    });

    // Let first call complete
    resolveFirst();

    // Wait for all processing to complete
    await vi.waitFor(() =>
      expect(service.updateLessonPriority).toHaveBeenCalledTimes(2)
    );

    // First in-flight call with P3, then only the last queued value P2 (P1 was coalesced away)
    expect(service.updateLessonPriority).toHaveBeenNthCalledWith(
      1,
      "db-l-1",
      3
    );
    expect(service.updateLessonPriority).toHaveBeenNthCalledWith(
      2,
      "db-l-1",
      2
    );
  });

  it("should coalesce multiple update-lesson-icon effects for the same lesson, only calling service once with final value", async () => {
    let resolveFirst!: () => void;
    const firstCallPromise = new Promise<void>((res) => {
      resolveFirst = res;
    });
    const service = {
      ...createMockService(),
      updateLessonIcon: vi
        .fn()
        .mockImplementationOnce(() =>
          firstCallPromise.then(() => ({ success: true }))
        )
        .mockResolvedValue({ success: true }),
    };
    const dispatch = vi.fn();
    const queue = new EffectQueue(service, dispatch);

    queue.enqueue({
      type: "update-lesson-icon",
      frontendId: fid("l-1"),
      lessonId: did("db-l-1"),
      icon: "code",
    });

    queue.enqueue({
      type: "update-lesson-icon",
      frontendId: fid("l-1"),
      lessonId: did("db-l-1"),
      icon: "discussion",
    });
    queue.enqueue({
      type: "update-lesson-icon",
      frontendId: fid("l-1"),
      lessonId: did("db-l-1"),
      icon: "watch",
    });

    resolveFirst();

    await vi.waitFor(() =>
      expect(service.updateLessonIcon).toHaveBeenCalledTimes(2)
    );

    expect(service.updateLessonIcon).toHaveBeenNthCalledWith(
      1,
      "db-l-1",
      "code"
    );
    expect(service.updateLessonIcon).toHaveBeenNthCalledWith(
      2,
      "db-l-1",
      "watch"
    );
  });

  it("should not coalesce effects for different lessons", async () => {
    const service = createMockService();
    const dispatch = vi.fn();
    const queue = new EffectQueue(service, dispatch);

    queue.enqueue({
      type: "update-lesson-priority",
      frontendId: fid("l-1"),
      lessonId: did("db-l-1"),
      priority: 3,
    });
    queue.enqueue({
      type: "update-lesson-priority",
      frontendId: fid("l-2"),
      lessonId: did("db-l-2"),
      priority: 1,
    });

    await vi.waitFor(() =>
      expect(service.updateLessonPriority).toHaveBeenCalledTimes(2)
    );
    expect(service.updateLessonPriority).toHaveBeenCalledWith("db-l-1", 3);
    expect(service.updateLessonPriority).toHaveBeenCalledWith("db-l-2", 1);
  });

  it("should not coalesce priority and icon effects for the same lesson", async () => {
    let resolveFirst!: () => void;
    const firstCallPromise = new Promise<void>((res) => {
      resolveFirst = res;
    });
    const service = {
      ...createMockService(),
      updateLessonPriority: vi
        .fn()
        .mockImplementationOnce(() =>
          firstCallPromise.then(() => ({ success: true }))
        )
        .mockResolvedValue({ success: true }),
    };
    const dispatch = vi.fn();
    const queue = new EffectQueue(service, dispatch);

    // Priority goes in-flight
    queue.enqueue({
      type: "update-lesson-priority",
      frontendId: fid("l-1"),
      lessonId: did("db-l-1"),
      priority: 3,
    });

    // Icon for the same lesson should NOT be coalesced away
    queue.enqueue({
      type: "update-lesson-icon",
      frontendId: fid("l-1"),
      lessonId: did("db-l-1"),
      icon: "code",
    });

    resolveFirst();

    await vi.waitFor(() =>
      expect(service.updateLessonPriority).toHaveBeenCalledTimes(1)
    );
    await vi.waitFor(() =>
      expect(service.updateLessonIcon).toHaveBeenCalledTimes(1)
    );

    expect(service.updateLessonPriority).toHaveBeenCalledWith("db-l-1", 3);
    expect(service.updateLessonIcon).toHaveBeenCalledWith("db-l-1", "code");
  });
});

describe("EffectQueue — hasUnresolvedItems", () => {
  it("returns false when queue is empty and not processing", () => {
    const service = createMockService();
    const queue = new EffectQueue(service, vi.fn());
    expect(queue.hasUnresolvedItems()).toBe(false);
  });

  it("returns true immediately after enqueueing an item", () => {
    const service = {
      ...createMockService(),
      // Never resolves, so processing stays true
      createSection: vi.fn().mockReturnValue(new Promise(() => {})),
    };
    const queue = new EffectQueue(service, vi.fn());
    queue.enqueue({
      type: "create-section",
      frontendId: fid("s-1"),
      repoVersionId: "v1",
      title: "Section",
      maxOrder: 0,
    });
    expect(queue.hasUnresolvedItems()).toBe(true);
  });

  it("returns false after all items have been processed", async () => {
    const service = createMockService();
    const dispatch = vi.fn();
    const queue = new EffectQueue(service, dispatch);

    queue.enqueue({
      type: "create-section",
      frontendId: fid("s-1"),
      repoVersionId: "v1",
      title: "Section",
      maxOrder: 0,
    });

    await vi.waitFor(() => expect(dispatch).toHaveBeenCalled());
    expect(queue.hasUnresolvedItems()).toBe(false);
  });

  it("returns true when multiple items are queued and first is still processing", () => {
    const service = {
      ...createMockService(),
      createSection: vi.fn().mockReturnValue(new Promise(() => {})),
    };
    const queue = new EffectQueue(service, vi.fn());

    queue.enqueue({
      type: "create-section",
      frontendId: fid("s-1"),
      repoVersionId: "v1",
      title: "First",
      maxOrder: 0,
    });
    queue.enqueue({
      type: "create-section",
      frontendId: fid("s-2"),
      repoVersionId: "v1",
      title: "Second",
      maxOrder: 1,
    });

    expect(queue.hasUnresolvedItems()).toBe(true);
  });

  it("returns false after multiple items have all been processed", async () => {
    const service = createMockService();
    const dispatch = vi.fn();
    const queue = new EffectQueue(service, dispatch);

    queue.enqueue({
      type: "create-section",
      frontendId: fid("s-1"),
      repoVersionId: "v1",
      title: "First",
      maxOrder: 0,
    });
    queue.enqueue({
      type: "create-section",
      frontendId: fid("s-2"),
      repoVersionId: "v1",
      title: "Second",
      maxOrder: 1,
    });

    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledTimes(2));
    expect(queue.hasUnresolvedItems()).toBe(false);
  });
});

describe("EffectQueue — section effects", () => {
  it("should dispatch section-created with the user title as path, not the database UUID", async () => {
    const service = {
      ...createMockService(),
      createSection: vi
        .fn()
        .mockResolvedValue({ success: true, sectionId: "db-uuid-abc123" }),
    };
    const dispatch = vi.fn();
    const queue = new EffectQueue(service, dispatch);

    queue.enqueue({
      type: "create-section",
      frontendId: fid("s-1"),
      repoVersionId: "v1",
      title: "Advanced Patterns",
      maxOrder: 0,
    });

    await vi.waitFor(() => expect(dispatch).toHaveBeenCalled());
    expect(dispatch).toHaveBeenCalledWith({
      type: "section-created",
      frontendId: fid("s-1"),
      databaseId: "db-uuid-abc123",
      path: "Advanced Patterns",
    });
  });
});

describe("EffectQueue — lesson effects", () => {
  it("should dispatch lesson-created with slug path, not the database UUID", async () => {
    const service = {
      ...createMockService(),
      addGhostLesson: vi
        .fn()
        .mockResolvedValue({ success: true, lessonId: "db-uuid-xyz789" }),
    };
    const dispatch = vi.fn();
    const queue = new EffectQueue(service, dispatch);

    queue.enqueue({
      type: "add-ghost-lesson",
      frontendId: fid("l-1"),
      sectionId: did("db-s-1"),
      title: "My Cool Lesson",
    });

    await vi.waitFor(() => expect(dispatch).toHaveBeenCalled());
    expect(dispatch).toHaveBeenCalledWith({
      type: "lesson-created",
      frontendId: fid("l-1"),
      databaseId: "db-uuid-xyz789",
      path: "my-cool-lesson",
    });
  });

  it("should resolve section FrontendId for add-ghost-lesson after create-section", async () => {
    const service = createMockService();
    const dispatch = vi.fn();
    const queue = new EffectQueue(service, dispatch);

    queue.enqueue({
      type: "create-section",
      frontendId: fid("s-1"),
      repoVersionId: "v1",
      title: "Section",
      maxOrder: 0,
    });
    queue.enqueue({
      type: "add-ghost-lesson",
      frontendId: fid("l-1"),
      sectionId: fid("s-1"),
      title: "Ghost Lesson",
    });

    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledTimes(2));
    expect(service.addGhostLesson).toHaveBeenCalledWith(
      "db-section-new",
      "Ghost Lesson",
      undefined
    );
    expect(queue.getIdMap().get(fid("l-1"))).toBe("db-lesson-new");
  });

  it("should resolve lesson FrontendId for delete-lesson", async () => {
    const service = createMockService();
    const dispatch = vi.fn();
    const queue = new EffectQueue(service, dispatch);

    queue.enqueue({
      type: "add-ghost-lesson",
      frontendId: fid("l-1"),
      sectionId: did("db-s-1"),
      title: "Lesson",
    });
    queue.enqueue({
      type: "delete-lesson",
      frontendId: fid("l-1"),
      lessonId: fid("l-1"),
    });

    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledTimes(2));
    expect(service.deleteLesson).toHaveBeenCalledWith("db-lesson-new");
  });

  it("should resolve both lesson and section FrontendIds for move", async () => {
    const service = {
      ...createMockService(),
      createSection: vi
        .fn()
        .mockResolvedValueOnce({ success: true, sectionId: "db-s-1" })
        .mockResolvedValueOnce({ success: true, sectionId: "db-s-2" }),
    };
    const dispatch = vi.fn();
    const queue = new EffectQueue(service, dispatch);

    queue.enqueue({
      type: "create-section",
      frontendId: fid("s-1"),
      repoVersionId: "v1",
      title: "Source",
      maxOrder: 0,
    });
    queue.enqueue({
      type: "create-section",
      frontendId: fid("s-2"),
      repoVersionId: "v1",
      title: "Target",
      maxOrder: 1,
    });
    queue.enqueue({
      type: "add-ghost-lesson",
      frontendId: fid("l-1"),
      sectionId: fid("s-1"),
      title: "Lesson",
    });
    queue.enqueue({
      type: "move-lesson-to-section",
      frontendId: fid("l-1"),
      lessonId: fid("l-1"),
      targetSectionId: fid("s-2"),
    });

    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledTimes(4));
    expect(service.moveLessonToSection).toHaveBeenCalledWith(
      "db-lesson-new",
      "db-s-2"
    );
  });

  it("should resolve FrontendIds for reorder-lessons", async () => {
    const service = {
      ...createMockService(),
      addGhostLesson: vi
        .fn()
        .mockResolvedValueOnce({ success: true, lessonId: "db-l-1" })
        .mockResolvedValueOnce({ success: true, lessonId: "db-l-2" }),
    };
    const dispatch = vi.fn();
    const queue = new EffectQueue(service, dispatch);

    queue.enqueue({
      type: "add-ghost-lesson",
      frontendId: fid("l-1"),
      sectionId: did("db-s-1"),
      title: "L1",
    });
    queue.enqueue({
      type: "add-ghost-lesson",
      frontendId: fid("l-2"),
      sectionId: did("db-s-1"),
      title: "L2",
    });
    queue.enqueue({
      type: "reorder-lessons",
      sectionId: did("db-s-1"),
      lessonIds: [fid("l-2"), fid("l-1")],
    });

    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledTimes(3));
    expect(service.reorderLessons).toHaveBeenCalledWith("db-s-1", [
      "db-l-2",
      "db-l-1",
    ]);
  });

  it("should pass adjacentLessonId and position", async () => {
    const service = createMockService();
    const dispatch = vi.fn();
    const queue = new EffectQueue(service, dispatch);

    queue.enqueue({
      type: "add-ghost-lesson",
      frontendId: fid("l-1"),
      sectionId: did("db-s-1"),
      title: "Inserted",
      adjacentLessonId: did("db-adj-1"),
      position: "before",
    });

    await vi.waitFor(() => expect(dispatch).toHaveBeenCalled());
    expect(service.addGhostLesson).toHaveBeenCalledWith("db-s-1", "Inserted", {
      adjacentLessonId: "db-adj-1",
      position: "before",
    });
  });

  it("should dispatch lesson-created for create-real-lesson with path", async () => {
    const service = createMockService();
    const dispatch = vi.fn();
    const queue = new EffectQueue(service, dispatch);

    queue.enqueue({
      type: "create-real-lesson",
      frontendId: fid("l-1"),
      sectionId: did("db-s-1"),
      title: "Real",
    });

    await vi.waitFor(() => expect(dispatch).toHaveBeenCalled());
    expect(dispatch).toHaveBeenCalledWith({
      type: "lesson-created",
      frontendId: fid("l-1"),
      databaseId: "db-lesson-new",
      path: "new-lesson",
    });
  });

  it("should handle update-lesson-name with server path", async () => {
    const service = createMockService();
    const dispatch = vi.fn();
    const queue = new EffectQueue(service, dispatch);

    queue.enqueue({
      type: "update-lesson-name",
      frontendId: fid("l-1"),
      lessonId: did("db-l-1"),
      newSlug: "new-slug",
    });

    await vi.waitFor(() => expect(dispatch).toHaveBeenCalled());
    expect(service.updateLessonName).toHaveBeenCalledWith("db-l-1", "new-slug");
    expect(dispatch).toHaveBeenCalledWith({
      type: "lesson-name-updated",
      frontendId: fid("l-1"),
      path: "renamed-lesson",
    });
  });

  it("should handle convert-to-ghost", async () => {
    const service = createMockService();
    const dispatch = vi.fn();
    const queue = new EffectQueue(service, dispatch);

    queue.enqueue({
      type: "convert-to-ghost",
      frontendId: fid("l-1"),
      lessonId: did("db-l-1"),
    });

    await vi.waitFor(() => expect(dispatch).toHaveBeenCalled());
    expect(service.convertToGhost).toHaveBeenCalledWith("db-l-1");
  });

  it("should handle create-on-disk with repoPath", async () => {
    const service = createMockService();
    const dispatch = vi.fn();
    const queue = new EffectQueue(service, dispatch);

    queue.enqueue({
      type: "create-on-disk",
      frontendId: fid("l-1"),
      lessonId: did("db-l-1"),
      repoPath: "/repo/path",
    });

    await vi.waitFor(() => expect(dispatch).toHaveBeenCalled());
    expect(service.createOnDisk).toHaveBeenCalledWith("db-l-1", {
      repoPath: "/repo/path",
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "lesson-created-on-disk",
      frontendId: fid("l-1"),
      path: "on-disk-path",
    });
  });

  it("should pass sectionPath and courseFilePath from create-on-disk response", async () => {
    const service = {
      ...createMockService(),
      createOnDisk: vi.fn().mockResolvedValue({
        success: true,
        path: "01-01-lesson",
        sectionId: "db-s-1",
        sectionPath: "01-intro",
        courseFilePath: "/repo/path",
      }),
    };
    const dispatch = vi.fn();
    const queue = new EffectQueue(service, dispatch);

    queue.enqueue({
      type: "create-on-disk",
      frontendId: fid("l-1"),
      lessonId: did("db-l-1"),
      repoPath: "/repo/path",
    });

    await vi.waitFor(() => expect(dispatch).toHaveBeenCalled());
    expect(dispatch).toHaveBeenCalledWith({
      type: "lesson-created-on-disk",
      frontendId: fid("l-1"),
      path: "01-01-lesson",
      sectionId: "db-s-1",
      sectionPath: "01-intro",
      courseFilePath: "/repo/path",
    });
  });
});
