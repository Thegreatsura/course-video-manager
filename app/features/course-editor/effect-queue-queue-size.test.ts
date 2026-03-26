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

describe("EffectQueue — queue size tracking", () => {
  it("calls onQueueSizeChange with a positive count when an effect is enqueued", () => {
    const service = createMockService();
    const dispatch = vi.fn();
    const onQueueSizeChange = vi.fn();
    const queue = new EffectQueue(service, dispatch, onQueueSizeChange);

    queue.enqueue({
      type: "update-lesson-title",
      frontendId: fid("l-1"),
      lessonId: did("db-l-1"),
      title: "New Title",
    });

    const calls = onQueueSizeChange.mock.calls.map(
      (args: unknown[]) => args[0] as number
    );
    expect(calls.some((n) => n > 0)).toBe(true);
  });

  it("calls onQueueSizeChange with 0 after all effects complete", async () => {
    const service = createMockService();
    const dispatch = vi.fn();
    const onQueueSizeChange = vi.fn();
    const queue = new EffectQueue(service, dispatch, onQueueSizeChange);

    queue.enqueue({
      type: "update-lesson-title",
      frontendId: fid("l-1"),
      lessonId: did("db-l-1"),
      title: "New Title",
    });

    await vi.waitFor(() => expect(dispatch).toHaveBeenCalled());

    const calls = onQueueSizeChange.mock.calls.map(
      (args: unknown[]) => args[0] as number
    );
    const lastCall = calls[calls.length - 1];
    expect(lastCall).toBe(0);
  });

  it("resets to 0 and continues processing after an effect throws", async () => {
    const service = createMockService();
    (
      service.updateLessonTitle as ReturnType<typeof vi.fn>
    ).mockRejectedValueOnce(new Error("network failure"));
    const dispatch = vi.fn();
    const onQueueSizeChange = vi.fn();
    const queue = new EffectQueue(service, dispatch, onQueueSizeChange);

    // First effect will fail
    queue.enqueue({
      type: "update-lesson-title",
      frontendId: fid("l-1"),
      lessonId: did("db-l-1"),
      title: "Fail",
    });

    // Wait for the failed effect to complete
    await vi.waitFor(() => {
      const calls = onQueueSizeChange.mock.calls.map(
        (args: unknown[]) => args[0] as number
      );
      expect(calls[calls.length - 1]).toBe(0);
    });

    // Second effect should still process (queue not stuck)
    queue.enqueue({
      type: "update-lesson-title",
      frontendId: fid("l-2"),
      lessonId: did("db-l-2"),
      title: "After failure",
    });

    await vi.waitFor(() => expect(dispatch).toHaveBeenCalled());

    const calls = onQueueSizeChange.mock.calls.map(
      (args: unknown[]) => args[0] as number
    );
    expect(calls[calls.length - 1]).toBe(0);
  });

  it("tracks size correctly across multiple sequential effects", async () => {
    const service = createMockService();
    const dispatch = vi.fn();
    const onQueueSizeChange = vi.fn();
    const queue = new EffectQueue(service, dispatch, onQueueSizeChange);

    queue.enqueue({
      type: "update-lesson-title",
      frontendId: fid("l-1"),
      lessonId: did("db-l-1"),
      title: "Title 1",
    });
    queue.enqueue({
      type: "update-lesson-title",
      frontendId: fid("l-2"),
      lessonId: did("db-l-2"),
      title: "Title 2",
    });

    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledTimes(2));

    const calls = onQueueSizeChange.mock.calls.map(
      (args: unknown[]) => args[0] as number
    );
    // Should have been called with > 0 at some point
    expect(calls.some((n) => n > 0)).toBe(true);
    // And finally called with 0
    expect(calls[calls.length - 1]).toBe(0);
  });
});
