/**
 * CourseEditorService Handler
 *
 * Processes CourseEditorEvents by delegating to CourseWriteService
 * (for structural operations) or DBFunctionsService (for property updates).
 * Also provides the direct transport factory for testing.
 */

import { Effect } from "effect";
import { CourseWriteService } from "./course-write-service";
import { DBFunctionsService } from "./db-service.server";
import { toSlug } from "./lesson-path-service";
import { parseSectionPath } from "./section-path-service";
import {
  createCourseEditorService,
  type CourseEditorEvent,
  type CourseEditorService,
} from "./course-editor-service";

// ============================================================================
// Handler
// ============================================================================

export const handleCourseEditorEvent = Effect.fn("handleCourseEditorEvent")(
  function* (event: CourseEditorEvent) {
    const service = yield* CourseWriteService;
    const db = yield* DBFunctionsService;

    switch (event.type) {
      // --- Section events ---
      case "create-section": {
        return yield* service.addGhostSection(
          event.repoVersionId,
          event.title,
          event.maxOrder
        );
      }

      case "update-section-name": {
        const section = yield* db.getSectionWithHierarchyById(event.sectionId);
        const parsed = parseSectionPath(section.path);
        if (parsed) {
          // Real (materialized) section: rename on disk with slug conversion
          const newSlug = toSlug(event.title.trim()) || "untitled";
          return yield* service.renameSection(event.sectionId, newSlug);
        }
        // Ghost section: just update the DB path with the raw title
        const newPath = event.title.trim() || "untitled";
        yield* db.updateSectionPath(event.sectionId, newPath);
        return { success: true, path: newPath };
      }

      case "update-section-description": {
        yield* db.getSectionWithHierarchyById(event.sectionId);
        yield* db.updateSectionDescription(
          event.sectionId,
          event.description.trim()
        );
        return { success: true };
      }

      case "archive-section": {
        return yield* service.archiveSection(event.sectionId);
      }

      case "reorder-sections": {
        return yield* service.reorderSections(event.sectionIds);
      }

      // --- Lesson events ---
      case "add-ghost-lesson": {
        return yield* service.addGhostLesson(event.sectionId, event.title, {
          adjacentLessonId: event.adjacentLessonId,
          position: event.position,
        });
      }

      case "create-real-lesson": {
        return yield* service.createRealLesson(event.sectionId, event.title, {
          adjacentLessonId: event.adjacentLessonId,
          position: event.position,
        });
      }

      case "update-lesson-name": {
        return yield* service.renameLesson(event.lessonId, event.newSlug);
      }

      case "update-lesson-title": {
        const lesson = yield* db.getLessonWithHierarchyById(event.lessonId);
        const slug = toSlug(event.title) || "untitled";
        yield* db.updateLesson(event.lessonId, {
          title: event.title.trim(),
          path: slug,
          sectionId: lesson.sectionId,
        });
        return { success: true };
      }

      case "update-lesson-description": {
        yield* db.getLessonWithHierarchyById(event.lessonId);
        yield* db.updateLesson(event.lessonId, {
          description: event.description.trim(),
        });
        return { success: true };
      }

      case "update-lesson-icon": {
        yield* db.getLessonWithHierarchyById(event.lessonId);
        yield* db.updateLesson(event.lessonId, {
          icon: event.icon,
        });
        return { success: true };
      }

      case "update-lesson-priority": {
        yield* db.getLessonWithHierarchyById(event.lessonId);
        yield* db.updateLesson(event.lessonId, {
          priority: event.priority,
        });
        return { success: true };
      }

      case "update-lesson-dependencies": {
        yield* db.getLessonWithHierarchyById(event.lessonId);
        yield* db.updateLesson(event.lessonId, {
          dependencies: event.dependencies,
        });
        return { success: true };
      }

      case "delete-lesson": {
        return yield* service.deleteLesson(event.lessonId);
      }

      case "reorder-lessons": {
        return yield* service.reorderLessons(event.sectionId, event.lessonIds);
      }

      case "move-lesson-to-section": {
        return yield* service.moveToSection(
          event.lessonId,
          event.targetSectionId
        );
      }

      case "convert-to-ghost": {
        return yield* service.convertToGhost(event.lessonId);
      }

      case "create-on-disk": {
        return yield* service.materializeGhost(event.lessonId, {
          repoPath: event.repoPath,
        });
      }

      default: {
        const _exhaustive: never = event;
        throw new Error(`Unknown event type: ${(_exhaustive as any).type}`);
      }
    }
  }
);

// ============================================================================
// Direct Transport Factory (for tests)
// ============================================================================

export function createDirectCourseEditorService(
  runtimePromise: (effect: Effect.Effect<any, any, any>) => Promise<any>
): CourseEditorService {
  const send = (event: CourseEditorEvent): Promise<unknown> => {
    return runtimePromise(handleCourseEditorEvent(event));
  };

  return createCourseEditorService(send);
}
