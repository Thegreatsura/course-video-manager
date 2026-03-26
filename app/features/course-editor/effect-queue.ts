import type { CourseEditorService } from "@/services/course-editor-service";
import { toSlug } from "@/services/lesson-path-service";
import type { courseEditorReducer } from "./course-editor-reducer";
import type { FrontendId, DatabaseId } from "./course-editor-types";

// ============================================================================
// Effect Queue
// ============================================================================

/**
 * FIFO queue that executes effects sequentially and resolves FrontendId
 * references to DatabaseId values before each effect is dispatched to the
 * service. On success, dispatches reconciliation actions back to the reducer.
 */
export class EffectQueue {
  private queue: courseEditorReducer.Effect[] = [];
  private processing = false;
  private idMap = new Map<FrontendId, DatabaseId>();
  private service: CourseEditorService;
  private dispatch: (action: courseEditorReducer.Action) => void;
  private onQueueSizeChange?: (size: number) => void;

  constructor(
    service: CourseEditorService,
    dispatch: (action: courseEditorReducer.Action) => void,
    onQueueSizeChange?: (size: number) => void
  ) {
    this.service = service;
    this.dispatch = dispatch;
    this.onQueueSizeChange = onQueueSizeChange;
  }

  enqueue(effect: courseEditorReducer.Effect): void {
    // Coalesce: for idempotent per-lesson updates, remove any pending (not yet
    // executing) effects of the same type targeting the same lesson so that
    // only the final state is sent to the server.
    if (
      effect.type === "update-lesson-priority" ||
      effect.type === "update-lesson-icon"
    ) {
      this.queue = this.queue.filter(
        (e) =>
          !(
            e.type === effect.type &&
            "lessonId" in e &&
            e.lessonId === effect.lessonId
          )
      );
    }
    this.queue.push(effect);
    this.notifyQueueSize();
    this.drain();
  }

  private notifyQueueSize(): void {
    const size = this.queue.length + (this.processing ? 1 : 0);
    this.onQueueSizeChange?.(size);
  }

  getIdMap(): Map<FrontendId, DatabaseId> {
    return new Map(this.idMap);
  }

  hasUnresolvedItems(): boolean {
    return this.processing || this.queue.length > 0;
  }

  // --------------------------------------------------------------------------
  // Private
  // --------------------------------------------------------------------------

  private async drain(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    while (this.queue.length > 0) {
      const effect = this.queue.shift()!;
      this.notifyQueueSize();
      try {
        await this.execute(effect);
      } catch {
        // Effect failed — skip it and continue draining remaining items
        // so the queue doesn't get permanently stuck.
      }
    }

    this.processing = false;
    this.notifyQueueSize();
  }

  private async execute(effect: courseEditorReducer.Effect): Promise<void> {
    switch (effect.type) {
      case "create-section": {
        const result = await this.service.createSection(
          effect.repoVersionId,
          effect.title,
          effect.maxOrder
        );
        this.idMap.set(effect.frontendId, result.sectionId as DatabaseId);
        this.dispatch({
          type: "section-created",
          frontendId: effect.frontendId,
          databaseId: result.sectionId as DatabaseId,
          path: effect.title.trim() || "untitled",
        });
        break;
      }

      case "rename-section": {
        const resolvedId = this.resolveId(effect.sectionId);
        await this.service.updateSectionName(resolvedId, effect.title);
        this.dispatch({
          type: "section-renamed",
          frontendId: effect.frontendId,
          path: effect.title, // Title becomes slug on server
        });
        break;
      }

      case "update-section-description": {
        const resolvedId = this.resolveId(effect.sectionId);
        await this.service.updateSectionDescription(
          resolvedId,
          effect.description
        );
        this.dispatch({
          type: "section-description-updated",
          frontendId: effect.frontendId,
        });
        break;
      }

      case "archive-section": {
        const resolvedId = this.resolveId(effect.sectionId);
        await this.service.archiveSection(resolvedId);
        this.dispatch({
          type: "section-archived",
          frontendId: effect.frontendId,
        });
        break;
      }

      case "reorder-sections": {
        const resolvedIds = effect.sectionIds.map((id) => this.resolveId(id));
        await this.service.reorderSections(resolvedIds);
        this.dispatch({
          type: "sections-reordered",
        });
        break;
      }

      // ====================================================================
      // Lesson effects
      // ====================================================================

      case "add-ghost-lesson": {
        const resolvedSectionId = this.resolveId(effect.sectionId);
        const opts: {
          adjacentLessonId?: string;
          position?: "before" | "after";
        } = {};
        if (effect.adjacentLessonId) {
          opts.adjacentLessonId = this.resolveId(effect.adjacentLessonId);
        }
        if (effect.position) {
          opts.position = effect.position;
        }
        const result = await this.service.addGhostLesson(
          resolvedSectionId,
          effect.title,
          Object.keys(opts).length > 0 ? opts : undefined
        );
        this.idMap.set(effect.frontendId, result.lessonId as DatabaseId);
        this.dispatch({
          type: "lesson-created",
          frontendId: effect.frontendId,
          databaseId: result.lessonId as DatabaseId,
          path: toSlug(effect.title) || "untitled",
        });
        break;
      }

      case "create-real-lesson": {
        const resolvedSectionId = this.resolveId(effect.sectionId);
        const opts: {
          adjacentLessonId?: string;
          position?: "before" | "after";
        } = {};
        if (effect.adjacentLessonId) {
          opts.adjacentLessonId = this.resolveId(effect.adjacentLessonId);
        }
        if (effect.position) {
          opts.position = effect.position;
        }
        const result = await this.service.createRealLesson(
          resolvedSectionId,
          effect.title,
          Object.keys(opts).length > 0 ? opts : undefined
        );
        this.idMap.set(effect.frontendId, result.lessonId as DatabaseId);
        this.dispatch({
          type: "lesson-created",
          frontendId: effect.frontendId,
          databaseId: result.lessonId as DatabaseId,
          path: result.path,
        });
        break;
      }

      case "update-lesson-name": {
        const resolvedId = this.resolveId(effect.lessonId);
        const result = await this.service.updateLessonName(
          resolvedId,
          effect.newSlug
        );
        this.dispatch({
          type: "lesson-name-updated",
          frontendId: effect.frontendId,
          path: result.path,
        });
        break;
      }

      case "update-lesson-title": {
        const resolvedId = this.resolveId(effect.lessonId);
        await this.service.updateLessonTitle(resolvedId, effect.title);
        this.dispatch({
          type: "lesson-title-updated",
          frontendId: effect.frontendId,
        });
        break;
      }

      case "update-lesson-description": {
        const resolvedId = this.resolveId(effect.lessonId);
        await this.service.updateLessonDescription(
          resolvedId,
          effect.description
        );
        this.dispatch({
          type: "lesson-description-updated",
          frontendId: effect.frontendId,
        });
        break;
      }

      case "update-lesson-icon": {
        const resolvedId = this.resolveId(effect.lessonId);
        await this.service.updateLessonIcon(
          resolvedId,
          effect.icon as "watch" | "code" | "discussion"
        );
        this.dispatch({
          type: "lesson-icon-updated",
          frontendId: effect.frontendId,
        });
        break;
      }

      case "update-lesson-priority": {
        const resolvedId = this.resolveId(effect.lessonId);
        await this.service.updateLessonPriority(
          resolvedId,
          effect.priority as 1 | 2 | 3
        );
        this.dispatch({
          type: "lesson-priority-updated",
          frontendId: effect.frontendId,
        });
        break;
      }

      case "update-lesson-dependencies": {
        const resolvedId = this.resolveId(effect.lessonId);
        await this.service.updateLessonDependencies(
          resolvedId,
          effect.dependencies
        );
        this.dispatch({
          type: "lesson-dependencies-updated",
          frontendId: effect.frontendId,
        });
        break;
      }

      case "delete-lesson": {
        const resolvedId = this.resolveId(effect.lessonId);
        await this.service.deleteLesson(resolvedId);
        this.dispatch({
          type: "lesson-deleted",
          frontendId: effect.frontendId,
        });
        break;
      }

      case "reorder-lessons": {
        const resolvedSectionId = this.resolveId(effect.sectionId);
        const resolvedLessonIds = effect.lessonIds.map((id) =>
          this.resolveId(id)
        );
        await this.service.reorderLessons(resolvedSectionId, resolvedLessonIds);
        this.dispatch({
          type: "lessons-reordered",
        });
        break;
      }

      case "move-lesson-to-section": {
        const resolvedLessonId = this.resolveId(effect.lessonId);
        const resolvedTargetId = this.resolveId(effect.targetSectionId);
        await this.service.moveLessonToSection(
          resolvedLessonId,
          resolvedTargetId
        );
        this.dispatch({
          type: "lesson-moved",
        });
        break;
      }

      case "convert-to-ghost": {
        const resolvedId = this.resolveId(effect.lessonId);
        await this.service.convertToGhost(resolvedId);
        this.dispatch({
          type: "lesson-converted-to-ghost",
          frontendId: effect.frontendId,
        });
        break;
      }

      case "create-on-disk": {
        const resolvedId = this.resolveId(effect.lessonId);
        const opts = effect.repoPath
          ? { repoPath: effect.repoPath }
          : undefined;
        const result = await this.service.createOnDisk(resolvedId, opts);
        this.dispatch({
          type: "lesson-created-on-disk",
          frontendId: effect.frontendId,
          path: result.path,
          ...(result.sectionId && {
            sectionId: result.sectionId,
            sectionPath: result.sectionPath,
          }),
          ...(result.courseFilePath && {
            courseFilePath: result.courseFilePath,
          }),
        });
        break;
      }
    }
  }

  /**
   * Resolve a FrontendId or DatabaseId to a DatabaseId.
   * If the id is already a DatabaseId (exists in the map as a value), return it.
   * If it's a FrontendId (exists as a key), return the mapped DatabaseId.
   * Otherwise return the id as-is (it may be a pre-existing DatabaseId from
   * initialization).
   */
  private resolveId(id: FrontendId | DatabaseId): string {
    // Check if this is a FrontendId that has been resolved
    const resolved = this.idMap.get(id as FrontendId);
    if (resolved) return resolved;
    // Already a DatabaseId or pre-existing ID
    return id;
  }
}
