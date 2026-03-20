import type { CourseEditorService } from "@/services/course-editor-service";
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

  constructor(
    service: CourseEditorService,
    dispatch: (action: courseEditorReducer.Action) => void
  ) {
    this.service = service;
    this.dispatch = dispatch;
  }

  enqueue(effect: courseEditorReducer.Effect): void {
    this.queue.push(effect);
    this.drain();
  }

  getIdMap(): Map<FrontendId, DatabaseId> {
    return new Map(this.idMap);
  }

  // --------------------------------------------------------------------------
  // Private
  // --------------------------------------------------------------------------

  private async drain(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    while (this.queue.length > 0) {
      const effect = this.queue.shift()!;
      await this.execute(effect);
    }

    this.processing = false;
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
          path: result.sectionId, // Server returns actual path via sectionId
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

      case "delete-section": {
        const resolvedId = this.resolveId(effect.sectionId);
        await this.service.deleteSection(resolvedId);
        this.dispatch({
          type: "section-deleted",
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
