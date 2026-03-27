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

describe("EffectQueue — onError callback", () => {
  it("calls onError with the effect type and message when create-on-disk fails", async () => {
    const service = createMockService();
    (service.createOnDisk as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error(
        "CourseEditorService request failed: 400 Directory is not a git repository: /not/a/repo"
      )
    );
    const dispatch = vi.fn();
    const onError = vi.fn();
    const queue = new EffectQueue(service, dispatch, undefined, onError);

    queue.enqueue({
      type: "create-on-disk",
      frontendId: fid("l-1"),
      lessonId: did("db-l-1"),
      repoPath: "/not/a/repo",
    });

    await vi.waitFor(() => expect(onError).toHaveBeenCalled());

    expect(onError).toHaveBeenCalledWith(
      "create-on-disk",
      "CourseEditorService request failed: 400 Directory is not a git repository: /not/a/repo"
    );
  });

  it("does not call onError when create-on-disk succeeds", async () => {
    const service = createMockService();
    const dispatch = vi.fn();
    const onError = vi.fn();
    const queue = new EffectQueue(service, dispatch, undefined, onError);

    queue.enqueue({
      type: "create-on-disk",
      frontendId: fid("l-1"),
      lessonId: did("db-l-1"),
      repoPath: "/valid/repo",
    });

    await vi.waitFor(() => expect(dispatch).toHaveBeenCalled());
    expect(onError).not.toHaveBeenCalled();
  });

  it("continues processing subsequent effects after an error", async () => {
    const service = createMockService();
    (service.createOnDisk as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("400 Directory is not a git repository")
    );
    const dispatch = vi.fn();
    const onError = vi.fn();
    const queue = new EffectQueue(service, dispatch, undefined, onError);

    queue.enqueue({
      type: "create-on-disk",
      frontendId: fid("l-1"),
      lessonId: did("db-l-1"),
      repoPath: "/bad/repo",
    });

    queue.enqueue({
      type: "update-lesson-title",
      frontendId: fid("l-2"),
      lessonId: did("db-l-2"),
      title: "After failure",
    });

    await vi.waitFor(() => expect(dispatch).toHaveBeenCalled());
    expect(onError).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: "lesson-title-updated" })
    );
  });

  it("stringifies non-Error thrown values", async () => {
    const service = createMockService();
    (service.createOnDisk as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      "plain string rejection"
    );
    const dispatch = vi.fn();
    const onError = vi.fn();
    const queue = new EffectQueue(service, dispatch, undefined, onError);

    queue.enqueue({
      type: "create-on-disk",
      frontendId: fid("l-1"),
      lessonId: did("db-l-1"),
      repoPath: "/bad",
    });

    await vi.waitFor(() => expect(onError).toHaveBeenCalled());
    expect(onError).toHaveBeenCalledWith(
      "create-on-disk",
      "plain string rejection"
    );
  });

  it("does not throw when onError is not provided", async () => {
    const service = createMockService();
    (service.createOnDisk as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("fail")
    );
    const dispatch = vi.fn();
    const queue = new EffectQueue(service, dispatch);

    queue.enqueue({
      type: "create-on-disk",
      frontendId: fid("l-1"),
      lessonId: did("db-l-1"),
      repoPath: "/bad",
    });

    // Enqueue a follow-up to prove the queue still drains
    queue.enqueue({
      type: "update-lesson-title",
      frontendId: fid("l-2"),
      lessonId: did("db-l-2"),
      title: "Still works",
    });

    await vi.waitFor(() => expect(dispatch).toHaveBeenCalled());
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: "lesson-title-updated" })
    );
  });
});
