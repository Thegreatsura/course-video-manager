import type { EffectReducerExec } from "use-effect-reducer";
import type { courseEditorReducer } from "./course-editor-reducer";
import type {
  FrontendId,
  EditorSection,
  EditorLesson,
} from "./course-editor-types";
import {
  parseLessonPath,
  buildLessonPath,
} from "@/services/lesson-path-service";

// ============================================================================
// Helpers
// ============================================================================

function toSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function generateFrontendId(): FrontendId {
  return crypto.randomUUID() as FrontendId;
}

export function findLesson(
  state: courseEditorReducer.State,
  frontendId: FrontendId
): { lesson: EditorLesson | undefined; section: EditorSection | undefined } {
  for (const section of state.sections) {
    const lesson = section.lessons.find((l) => l.frontendId === frontendId);
    if (lesson) return { lesson, section };
  }
  return { lesson: undefined, section: undefined };
}

export function updateLesson(
  state: courseEditorReducer.State,
  frontendId: FrontendId,
  updater: (lesson: EditorLesson) => EditorLesson
): EditorSection[] {
  return state.sections.map((s) => ({
    ...s,
    lessons: s.lessons.map((l) =>
      l.frontendId === frontendId ? updater(l) : l
    ),
  }));
}

// ============================================================================
// Lesson case handler
// ============================================================================

type Exec = EffectReducerExec<
  courseEditorReducer.State,
  courseEditorReducer.Action,
  courseEditorReducer.Effect
>;

/**
 * Handles lesson entity actions and lesson reconciliation actions.
 * Returns new state if handled, null if action is not a lesson action.
 */
export function handleLessonCase(
  state: courseEditorReducer.State,
  action: courseEditorReducer.Action,
  exec: Exec
): courseEditorReducer.State | null {
  switch (action.type) {
    case "add-ghost-lesson":
    case "create-real-lesson": {
      const section = state.sections.find(
        (s) => s.frontendId === action.sectionFrontendId
      );
      if (!section) return state;

      const frontendId = generateFrontendId();
      const slug = toSlug(action.title.trim()) || "untitled";
      const sectionId = section.databaseId ?? section.frontendId;

      const newLesson: EditorLesson = {
        frontendId,
        databaseId: null,
        sectionId: section.databaseId ?? section.frontendId,
        path: slug,
        title: action.title,
        fsStatus: action.type === "add-ghost-lesson" ? "ghost" : "real",
        description: "",
        icon: null,
        priority: 2,
        dependencies: null,
        order: 0,
        videos: [],
      };

      let newLessons: EditorLesson[];
      if (action.adjacentLessonId && action.position) {
        const adjIdx = section.lessons.findIndex(
          (l) => l.frontendId === action.adjacentLessonId
        );
        if (adjIdx === -1) {
          newLessons = [...section.lessons, newLesson];
        } else {
          const insertIdx = action.position === "before" ? adjIdx : adjIdx + 1;
          newLessons = [...section.lessons];
          newLessons.splice(insertIdx, 0, newLesson);
        }
      } else {
        newLessons = [...section.lessons, newLesson];
      }

      newLessons = newLessons.map((l, i) => ({ ...l, order: i + 1 }));

      const adjacentLessonDb = action.adjacentLessonId
        ? (() => {
            const adj = section.lessons.find(
              (l) => l.frontendId === action.adjacentLessonId
            );
            return adj ? (adj.databaseId ?? adj.frontendId) : undefined;
          })()
        : undefined;

      exec({
        type: action.type,
        frontendId,
        sectionId,
        title: action.title,
        ...(adjacentLessonDb && { adjacentLessonId: adjacentLessonDb }),
        ...(action.position && { position: action.position }),
      } as courseEditorReducer.Effect);

      return {
        ...state,
        sections: state.sections.map((s) =>
          s.frontendId === action.sectionFrontendId
            ? { ...s, lessons: newLessons }
            : s
        ),
      };
    }

    case "update-lesson-name": {
      const { lesson } = findLesson(state, action.frontendId);
      if (!lesson) return state;
      const slug = toSlug(action.newSlug) || "untitled";
      const parsed = parseLessonPath(lesson.path);
      const newPath = parsed
        ? buildLessonPath(parsed.sectionNumber ?? 1, parsed.lessonNumber, slug)
        : slug;
      exec({
        type: "update-lesson-name",
        frontendId: action.frontendId,
        lessonId: lesson.databaseId ?? lesson.frontendId,
        newSlug: slug,
      });
      return {
        ...state,
        sections: updateLesson(state, action.frontendId, (l) => ({
          ...l,
          path: newPath,
        })),
      };
    }

    case "update-lesson-title": {
      const { lesson } = findLesson(state, action.frontendId);
      if (!lesson) return state;
      exec({
        type: "update-lesson-title",
        frontendId: action.frontendId,
        lessonId: lesson.databaseId ?? lesson.frontendId,
        title: action.title,
      });
      return {
        ...state,
        sections: updateLesson(state, action.frontendId, (l) => ({
          ...l,
          title: action.title,
        })),
      };
    }

    case "update-lesson-description": {
      const { lesson } = findLesson(state, action.frontendId);
      if (!lesson) return state;
      exec({
        type: "update-lesson-description",
        frontendId: action.frontendId,
        lessonId: lesson.databaseId ?? lesson.frontendId,
        description: action.description,
      });
      return {
        ...state,
        sections: updateLesson(state, action.frontendId, (l) => ({
          ...l,
          description: action.description,
        })),
      };
    }

    case "update-lesson-icon": {
      const { lesson } = findLesson(state, action.frontendId);
      if (!lesson) return state;
      exec({
        type: "update-lesson-icon",
        frontendId: action.frontendId,
        lessonId: lesson.databaseId ?? lesson.frontendId,
        icon: action.icon,
      });
      return {
        ...state,
        sections: updateLesson(state, action.frontendId, (l) => ({
          ...l,
          icon: action.icon,
        })),
      };
    }

    case "update-lesson-priority": {
      const { lesson } = findLesson(state, action.frontendId);
      if (!lesson) return state;
      exec({
        type: "update-lesson-priority",
        frontendId: action.frontendId,
        lessonId: lesson.databaseId ?? lesson.frontendId,
        priority: action.priority,
      });
      return {
        ...state,
        sections: updateLesson(state, action.frontendId, (l) => ({
          ...l,
          priority: action.priority,
        })),
      };
    }

    case "update-lesson-dependencies": {
      const { lesson } = findLesson(state, action.frontendId);
      if (!lesson) return state;
      exec({
        type: "update-lesson-dependencies",
        frontendId: action.frontendId,
        lessonId: lesson.databaseId ?? lesson.frontendId,
        dependencies: action.dependencies,
      });
      return {
        ...state,
        sections: updateLesson(state, action.frontendId, (l) => ({
          ...l,
          dependencies: action.dependencies,
        })),
      };
    }

    case "delete-lesson": {
      const { lesson, section } = findLesson(state, action.frontendId);
      if (!lesson || !section) return state;
      exec({
        type: "delete-lesson",
        frontendId: action.frontendId,
        lessonId: lesson.databaseId ?? lesson.frontendId,
      });
      return {
        ...state,
        sections: state.sections.map((s) =>
          s.frontendId === section.frontendId
            ? {
                ...s,
                lessons: s.lessons
                  .filter((l) => l.frontendId !== action.frontendId)
                  .map((l, i) => ({ ...l, order: i + 1 })),
              }
            : s
        ),
      };
    }

    case "reorder-lessons": {
      const section = state.sections.find(
        (s) => s.frontendId === action.sectionFrontendId
      );
      if (!section) return state;
      const lessonMap = new Map(section.lessons.map((l) => [l.frontendId, l]));
      const reorderedLessons = action.lessonFrontendIds
        .map((fid) => lessonMap.get(fid))
        .filter((l): l is EditorLesson => l != null)
        .map((l, i) => ({ ...l, order: i + 1 }));
      exec({
        type: "reorder-lessons",
        sectionId: section.databaseId ?? section.frontendId,
        lessonIds: reorderedLessons.map((l) => l.databaseId ?? l.frontendId),
      });
      return {
        ...state,
        sections: state.sections.map((s) =>
          s.frontendId === action.sectionFrontendId
            ? { ...s, lessons: reorderedLessons }
            : s
        ),
      };
    }

    case "move-lesson-to-section": {
      const { lesson, section: sourceSection } = findLesson(
        state,
        action.lessonFrontendId
      );
      const targetSection = state.sections.find(
        (s) => s.frontendId === action.targetSectionFrontendId
      );
      if (!lesson || !sourceSection || !targetSection) return state;
      const targetSectionId =
        targetSection.databaseId ?? targetSection.frontendId;
      exec({
        type: "move-lesson-to-section",
        frontendId: action.lessonFrontendId,
        lessonId: lesson.databaseId ?? lesson.frontendId,
        targetSectionId,
      });
      return {
        ...state,
        sections: state.sections.map((s) => {
          if (s.frontendId === sourceSection.frontendId) {
            return {
              ...s,
              lessons: s.lessons
                .filter((l) => l.frontendId !== action.lessonFrontendId)
                .map((l, i) => ({ ...l, order: i + 1 })),
            };
          }
          if (s.frontendId === action.targetSectionFrontendId) {
            return {
              ...s,
              lessons: [
                ...s.lessons,
                {
                  ...lesson,
                  sectionId: targetSectionId,
                  order: s.lessons.length + 1,
                },
              ],
            };
          }
          return s;
        }),
      };
    }

    case "convert-to-ghost": {
      const { lesson } = findLesson(state, action.frontendId);
      if (!lesson) return state;
      exec({
        type: "convert-to-ghost",
        frontendId: action.frontendId,
        lessonId: lesson.databaseId ?? lesson.frontendId,
      });
      return {
        ...state,
        sections: updateLesson(state, action.frontendId, (l) => ({
          ...l,
          fsStatus: "ghost",
        })),
      };
    }

    case "create-on-disk": {
      const { lesson } = findLesson(state, action.frontendId);
      if (!lesson) return state;
      exec({
        type: "create-on-disk",
        frontendId: action.frontendId,
        lessonId: lesson.databaseId ?? lesson.frontendId,
        ...(action.repoPath && { repoPath: action.repoPath }),
      });
      return {
        ...state,
        sections: updateLesson(state, action.frontendId, (l) => ({
          ...l,
          fsStatus: "real",
        })),
      };
    }

    // Lesson reconciliation actions
    case "lesson-created":
      return {
        ...state,
        sections: updateLesson(state, action.frontendId, (l) => ({
          ...l,
          databaseId: action.databaseId,
          path: action.path,
        })),
      };

    case "lesson-name-updated":
      return {
        ...state,
        sections: updateLesson(state, action.frontendId, (l) => ({
          ...l,
          path: action.path,
        })),
      };

    case "lesson-created-on-disk": {
      let sections = updateLesson(state, action.frontendId, (l) => ({
        ...l,
        path: action.path,
        fsStatus: "real",
      }));
      // Update section path if the section was materialized
      if (action.sectionId && action.sectionPath) {
        sections = sections.map((s) =>
          (s.databaseId as string) === action.sectionId ||
          (s.frontendId as string) === action.sectionId
            ? { ...s, path: action.sectionPath! }
            : s
        );
      }
      return {
        ...state,
        sections,
        // Update courseFilePath if newly assigned
        ...(action.courseFilePath && {
          courseFilePath: action.courseFilePath,
        }),
      };
    }

    case "lesson-title-updated":
    case "lesson-description-updated":
    case "lesson-icon-updated":
    case "lesson-priority-updated":
    case "lesson-dependencies-updated":
    case "lesson-deleted":
    case "lessons-reordered":
    case "lesson-moved":
    case "lesson-converted-to-ghost":
      return state;

    default:
      return null;
  }
}
