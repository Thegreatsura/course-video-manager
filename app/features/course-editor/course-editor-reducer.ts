import type { EffectReducer } from "use-effect-reducer";
import type {
  FrontendId,
  DatabaseId,
  EditorSection,
} from "./course-editor-types";
import type { Lesson } from "@/features/course-view/course-view-types";
import { handleLessonCase } from "./course-editor-lesson-cases";

// ============================================================================
// Namespace: State, Action, Effect
// ============================================================================

export namespace courseEditorReducer {
  export type VideoPlayerState = {
    isOpen: boolean;
    videoId: string;
    videoPath: string;
  };

  export type MoveVideoState = {
    videoId: string;
    videoPath: string;
    currentLessonId: string;
  } | null;

  export type MoveLessonState = {
    lessonId: string;
    lessonTitle: string;
    currentSectionId: string;
  } | null;

  export type RenameVideoState = {
    videoId: string;
    videoPath: string;
  } | null;

  export type State = {
    sections: EditorSection[];
    courseFilePath: string | null;
    isAddCourseModalOpen: boolean;
    isCreateSectionModalOpen: boolean;
    isVersionSelectorModalOpen: boolean;
    isRenameCourseModalOpen: boolean;
    isPurgeExportsModalOpen: boolean;
    isRewriteCoursePathModalOpen: boolean;
    isAddStandaloneVideoModalOpen: boolean;
    isCopyTranscriptModalOpen: boolean;
    copySectionTranscriptState: {
      sectionPath: string;
      lessons: Lesson[];
    } | null;
    addGhostLessonSectionId: FrontendId | null;
    insertAdjacentLessonId: FrontendId | null;
    insertPosition: "before" | "after" | null;
    addVideoToLessonId: FrontendId | null;
    editLessonId: FrontendId | null;
    editSectionId: FrontendId | null;
    convertToGhostLessonId: FrontendId | null;
    deleteLessonId: FrontendId | null;
    archiveSectionId: FrontendId | null;
    createOnDiskLessonId: FrontendId | null;
    videoPlayerState: VideoPlayerState;
    moveVideoState: MoveVideoState;
    moveLessonState: MoveLessonState;
    renameVideoState: RenameVideoState;
    priorityFilter: number[];
    iconFilter: string[];
    fsStatusFilter: string | null;
    searchQuery: string;
  };

  export type Action =
    | { type: "add-section"; title: string; repoVersionId: string }
    | { type: "rename-section"; frontendId: FrontendId; title: string }
    | {
        type: "update-section-description";
        frontendId: FrontendId;
        description: string;
      }
    | { type: "archive-section"; frontendId: FrontendId }
    | { type: "reorder-sections"; frontendIds: FrontendId[] }
    | {
        type: "add-ghost-lesson";
        sectionFrontendId: FrontendId;
        title: string;
        adjacentLessonId?: FrontendId;
        position?: "before" | "after";
      }
    | {
        type: "create-real-lesson";
        sectionFrontendId: FrontendId;
        title: string;
        adjacentLessonId?: FrontendId;
        position?: "before" | "after";
      }
    | { type: "update-lesson-name"; frontendId: FrontendId; newSlug: string }
    | { type: "update-lesson-title"; frontendId: FrontendId; title: string }
    | {
        type: "update-lesson-description";
        frontendId: FrontendId;
        description: string;
      }
    | { type: "update-lesson-icon"; frontendId: FrontendId; icon: string }
    | {
        type: "update-lesson-priority";
        frontendId: FrontendId;
        priority: number;
      }
    | {
        type: "update-lesson-dependencies";
        frontendId: FrontendId;
        dependencies: string[];
      }
    | { type: "delete-lesson"; frontendId: FrontendId }
    | {
        type: "reorder-lessons";
        sectionFrontendId: FrontendId;
        lessonFrontendIds: FrontendId[];
      }
    | {
        type: "move-lesson-to-section";
        lessonFrontendId: FrontendId;
        targetSectionFrontendId: FrontendId;
      }
    | { type: "convert-to-ghost"; frontendId: FrontendId }
    | { type: "create-on-disk"; frontendId: FrontendId; repoPath?: string }
    | {
        type: "section-created";
        frontendId: FrontendId;
        databaseId: DatabaseId;
        path: string;
      }
    | { type: "section-renamed"; frontendId: FrontendId; path: string }
    | { type: "section-description-updated"; frontendId: FrontendId }
    | { type: "section-archived"; frontendId: FrontendId }
    | { type: "sections-reordered" }
    | {
        type: "lesson-created";
        frontendId: FrontendId;
        databaseId: DatabaseId;
        path: string;
      }
    | { type: "lesson-name-updated"; frontendId: FrontendId; path: string }
    | { type: "lesson-title-updated"; frontendId: FrontendId }
    | { type: "lesson-description-updated"; frontendId: FrontendId }
    | { type: "lesson-icon-updated"; frontendId: FrontendId }
    | { type: "lesson-priority-updated"; frontendId: FrontendId }
    | { type: "lesson-dependencies-updated"; frontendId: FrontendId }
    | { type: "lesson-deleted"; frontendId: FrontendId }
    | { type: "lessons-reordered" }
    | { type: "lesson-moved" }
    | { type: "lesson-converted-to-ghost"; frontendId: FrontendId }
    | {
        type: "lesson-created-on-disk";
        frontendId: FrontendId;
        path: string;
        sectionId?: string;
        sectionPath?: string;
        courseFilePath?: string;
      }
    | { type: "set-add-course-modal-open"; open: boolean }
    | { type: "set-create-section-modal-open"; open: boolean }
    | { type: "set-version-selector-modal-open"; open: boolean }
    | { type: "set-rename-course-modal-open"; open: boolean }
    | { type: "set-purge-exports-modal-open"; open: boolean }
    | { type: "set-rewrite-course-path-modal-open"; open: boolean }
    | { type: "set-add-standalone-video-modal-open"; open: boolean }
    | { type: "set-copy-transcript-modal-open"; open: boolean }
    | {
        type: "open-copy-section-transcript";
        sectionPath: string;
        lessons: Lesson[];
      }
    | { type: "close-copy-section-transcript" }
    | { type: "set-add-lesson-section-id"; sectionId: FrontendId | null }
    | {
        type: "set-insert-lesson";
        sectionId: FrontendId;
        adjacentLessonId: FrontendId;
        position: "before" | "after";
      }
    | { type: "set-add-video-to-lesson-id"; lessonId: FrontendId | null }
    | { type: "set-edit-lesson-id"; lessonId: FrontendId | null }
    | { type: "set-edit-section-id"; sectionId: FrontendId | null }
    | {
        type: "set-convert-to-ghost-lesson-id";
        lessonId: FrontendId | null;
      }
    | { type: "set-delete-lesson-id"; lessonId: FrontendId | null }
    | { type: "set-archive-section-id"; sectionId: FrontendId | null }
    | { type: "set-create-on-disk-lesson-id"; lessonId: FrontendId | null }
    | { type: "open-video-player"; videoId: string; videoPath: string }
    | { type: "close-video-player" }
    | {
        type: "open-move-video";
        videoId: string;
        videoPath: string;
        currentLessonId: string;
      }
    | { type: "close-move-video" }
    | {
        type: "open-move-lesson";
        lessonId: string;
        lessonTitle: string;
        currentSectionId: string;
      }
    | { type: "close-move-lesson" }
    | { type: "open-rename-video"; videoId: string; videoPath: string }
    | { type: "close-rename-video" }
    | { type: "toggle-priority-filter"; priority: number }
    | { type: "toggle-icon-filter"; icon: string }
    | { type: "toggle-fs-status-filter"; status: string }
    | { type: "set-search-query"; query: string };

  export type Effect =
    | {
        type: "create-section";
        frontendId: FrontendId;
        repoVersionId: string;
        title: string;
        maxOrder: number;
      }
    | {
        type: "rename-section";
        frontendId: FrontendId;
        sectionId: FrontendId | DatabaseId;
        title: string;
      }
    | {
        type: "update-section-description";
        frontendId: FrontendId;
        sectionId: FrontendId | DatabaseId;
        description: string;
      }
    | {
        type: "archive-section";
        frontendId: FrontendId;
        sectionId: FrontendId | DatabaseId;
      }
    | { type: "reorder-sections"; sectionIds: (FrontendId | DatabaseId)[] }
    | {
        type: "add-ghost-lesson";
        frontendId: FrontendId;
        sectionId: FrontendId | DatabaseId;
        title: string;
        adjacentLessonId?: FrontendId | DatabaseId;
        position?: "before" | "after";
      }
    | {
        type: "create-real-lesson";
        frontendId: FrontendId;
        sectionId: FrontendId | DatabaseId;
        title: string;
        adjacentLessonId?: FrontendId | DatabaseId;
        position?: "before" | "after";
      }
    | {
        type: "update-lesson-name";
        frontendId: FrontendId;
        lessonId: FrontendId | DatabaseId;
        newSlug: string;
      }
    | {
        type: "update-lesson-title";
        frontendId: FrontendId;
        lessonId: FrontendId | DatabaseId;
        title: string;
      }
    | {
        type: "update-lesson-description";
        frontendId: FrontendId;
        lessonId: FrontendId | DatabaseId;
        description: string;
      }
    | {
        type: "update-lesson-icon";
        frontendId: FrontendId;
        lessonId: FrontendId | DatabaseId;
        icon: string;
      }
    | {
        type: "update-lesson-priority";
        frontendId: FrontendId;
        lessonId: FrontendId | DatabaseId;
        priority: number;
      }
    | {
        type: "update-lesson-dependencies";
        frontendId: FrontendId;
        lessonId: FrontendId | DatabaseId;
        dependencies: string[];
      }
    | {
        type: "delete-lesson";
        frontendId: FrontendId;
        lessonId: FrontendId | DatabaseId;
      }
    | {
        type: "reorder-lessons";
        sectionId: FrontendId | DatabaseId;
        lessonIds: (FrontendId | DatabaseId)[];
      }
    | {
        type: "move-lesson-to-section";
        frontendId: FrontendId;
        lessonId: FrontendId | DatabaseId;
        targetSectionId: FrontendId | DatabaseId;
      }
    | {
        type: "convert-to-ghost";
        frontendId: FrontendId;
        lessonId: FrontendId | DatabaseId;
      }
    | {
        type: "create-on-disk";
        frontendId: FrontendId;
        lessonId: FrontendId | DatabaseId;
        repoPath?: string;
      };
}

// ============================================================================
// Helpers
// ============================================================================

function generateFrontendId(): FrontendId {
  return crypto.randomUUID() as FrontendId;
}

// ============================================================================
// Initial State Factory
// ============================================================================

export function createInitialCourseEditorState(
  sections: EditorSection[] = [],
  opts?: { courseFilePath?: string | null }
): courseEditorReducer.State {
  return {
    sections,
    courseFilePath: opts?.courseFilePath ?? null,
    isAddCourseModalOpen: false,
    isCreateSectionModalOpen: false,
    isVersionSelectorModalOpen: false,
    isRenameCourseModalOpen: false,
    isPurgeExportsModalOpen: false,
    isRewriteCoursePathModalOpen: false,
    isAddStandaloneVideoModalOpen: false,
    isCopyTranscriptModalOpen: false,
    copySectionTranscriptState: null,
    addGhostLessonSectionId: null,
    insertAdjacentLessonId: null,
    insertPosition: null,
    addVideoToLessonId: null,
    editLessonId: null,
    editSectionId: null,
    convertToGhostLessonId: null,
    deleteLessonId: null,
    archiveSectionId: null,
    createOnDiskLessonId: null,
    videoPlayerState: { isOpen: false, videoId: "", videoPath: "" },
    moveVideoState: null,
    moveLessonState: null,
    renameVideoState: null,
    priorityFilter: [],
    iconFilter: [],
    fsStatusFilter: null,
    searchQuery: "",
  };
}

// ============================================================================
// Reducer
// ============================================================================

export const courseEditorReducer: EffectReducer<
  courseEditorReducer.State,
  courseEditorReducer.Action,
  courseEditorReducer.Effect
> = (state, action, exec) => {
  // Delegate lesson actions to the lesson case handler
  const lessonResult = handleLessonCase(state, action, exec);
  if (lessonResult !== null) return lessonResult;

  switch (action.type) {
    case "add-section": {
      const frontendId = generateFrontendId();
      const maxOrder = state.sections.reduce(
        (max, s) => Math.max(max, s.order),
        0
      );
      const newSection: EditorSection = {
        frontendId,
        databaseId: null,
        repoVersionId: action.repoVersionId,
        path: action.title.trim() || "untitled",
        description: "",
        order: maxOrder + 1,
        lessons: [],
      };
      exec({
        type: "create-section",
        frontendId,
        repoVersionId: action.repoVersionId,
        title: action.title,
        maxOrder,
      });
      return { ...state, sections: [...state.sections, newSection] };
    }

    case "rename-section": {
      const section = state.sections.find(
        (s) => s.frontendId === action.frontendId
      );
      if (!section) return state;
      const newPath = action.title.trim() || "untitled";
      exec({
        type: "rename-section",
        frontendId: action.frontendId,
        sectionId: section.databaseId ?? section.frontendId,
        title: action.title,
      });
      return {
        ...state,
        sections: state.sections.map((s) =>
          s.frontendId === action.frontendId ? { ...s, path: newPath } : s
        ),
      };
    }

    case "update-section-description": {
      const section = state.sections.find(
        (s) => s.frontendId === action.frontendId
      );
      if (!section) return state;
      exec({
        type: "update-section-description",
        frontendId: action.frontendId,
        sectionId: section.databaseId ?? section.frontendId,
        description: action.description,
      });
      return {
        ...state,
        sections: state.sections.map((s) =>
          s.frontendId === action.frontendId
            ? { ...s, description: action.description }
            : s
        ),
      };
    }

    case "archive-section": {
      const section = state.sections.find(
        (s) => s.frontendId === action.frontendId
      );
      if (!section) return state;
      exec({
        type: "archive-section",
        frontendId: action.frontendId,
        sectionId: section.databaseId ?? section.frontendId,
      });
      return {
        ...state,
        sections: state.sections.filter(
          (s) => s.frontendId !== action.frontendId
        ),
      };
    }

    case "reorder-sections": {
      const sectionMap = new Map(state.sections.map((s) => [s.frontendId, s]));
      const reordered = action.frontendIds
        .map((fid) => sectionMap.get(fid))
        .filter((s): s is EditorSection => s != null)
        .map((s, i) => ({ ...s, order: i + 1 }));
      exec({
        type: "reorder-sections",
        sectionIds: reordered.map((s) => s.databaseId ?? s.frontendId),
      });
      return { ...state, sections: reordered };
    }

    case "section-created":
      return {
        ...state,
        sections: state.sections.map((s) =>
          s.frontendId === action.frontendId
            ? { ...s, databaseId: action.databaseId, path: action.path }
            : s
        ),
      };

    case "section-renamed":
      return {
        ...state,
        sections: state.sections.map((s) =>
          s.frontendId === action.frontendId ? { ...s, path: action.path } : s
        ),
      };

    case "section-description-updated":
    case "section-archived":
    case "sections-reordered":
      return state;

    case "set-add-course-modal-open":
      return { ...state, isAddCourseModalOpen: action.open };
    case "set-create-section-modal-open":
      return { ...state, isCreateSectionModalOpen: action.open };
    case "set-version-selector-modal-open":
      return { ...state, isVersionSelectorModalOpen: action.open };
    case "set-rename-course-modal-open":
      return { ...state, isRenameCourseModalOpen: action.open };
    case "set-purge-exports-modal-open":
      return { ...state, isPurgeExportsModalOpen: action.open };
    case "set-rewrite-course-path-modal-open":
      return { ...state, isRewriteCoursePathModalOpen: action.open };
    case "set-add-standalone-video-modal-open":
      return { ...state, isAddStandaloneVideoModalOpen: action.open };
    case "set-copy-transcript-modal-open":
      return { ...state, isCopyTranscriptModalOpen: action.open };
    case "open-copy-section-transcript":
      return {
        ...state,
        copySectionTranscriptState: {
          sectionPath: action.sectionPath,
          lessons: action.lessons,
        },
      };
    case "close-copy-section-transcript":
      return { ...state, copySectionTranscriptState: null };
    case "set-add-lesson-section-id":
      return {
        ...state,
        addGhostLessonSectionId: action.sectionId,
        insertAdjacentLessonId: null,
        insertPosition: null,
      };
    case "set-insert-lesson":
      return {
        ...state,
        addGhostLessonSectionId: action.sectionId,
        insertAdjacentLessonId: action.adjacentLessonId,
        insertPosition: action.position,
      };
    case "set-add-video-to-lesson-id":
      return { ...state, addVideoToLessonId: action.lessonId };
    case "set-edit-lesson-id":
      return { ...state, editLessonId: action.lessonId };
    case "set-edit-section-id":
      return { ...state, editSectionId: action.sectionId };
    case "set-convert-to-ghost-lesson-id":
      return { ...state, convertToGhostLessonId: action.lessonId };
    case "set-delete-lesson-id":
      return { ...state, deleteLessonId: action.lessonId };
    case "set-archive-section-id":
      return { ...state, archiveSectionId: action.sectionId };
    case "set-create-on-disk-lesson-id":
      return { ...state, createOnDiskLessonId: action.lessonId };
    case "open-video-player":
      return {
        ...state,
        videoPlayerState: {
          isOpen: true,
          videoId: action.videoId,
          videoPath: action.videoPath,
        },
      };
    case "close-video-player":
      return {
        ...state,
        videoPlayerState: { isOpen: false, videoId: "", videoPath: "" },
      };
    case "open-move-video":
      return {
        ...state,
        moveVideoState: {
          videoId: action.videoId,
          videoPath: action.videoPath,
          currentLessonId: action.currentLessonId,
        },
      };
    case "close-move-video":
      return { ...state, moveVideoState: null };
    case "open-move-lesson":
      return {
        ...state,
        moveLessonState: {
          lessonId: action.lessonId,
          lessonTitle: action.lessonTitle,
          currentSectionId: action.currentSectionId,
        },
      };
    case "close-move-lesson":
      return { ...state, moveLessonState: null };
    case "open-rename-video":
      return {
        ...state,
        renameVideoState: {
          videoId: action.videoId,
          videoPath: action.videoPath,
        },
      };
    case "close-rename-video":
      return { ...state, renameVideoState: null };
    case "toggle-priority-filter":
      return {
        ...state,
        priorityFilter: state.priorityFilter.includes(action.priority)
          ? state.priorityFilter.filter((p) => p !== action.priority)
          : [...state.priorityFilter, action.priority],
      };
    case "toggle-icon-filter":
      return {
        ...state,
        iconFilter: state.iconFilter.includes(action.icon)
          ? state.iconFilter.filter((i) => i !== action.icon)
          : [...state.iconFilter, action.icon],
      };
    case "toggle-fs-status-filter":
      return {
        ...state,
        fsStatusFilter:
          state.fsStatusFilter === action.status ? null : action.status,
      };
    case "set-search-query":
      return { ...state, searchQuery: action.query };
    default:
      return state;
  }
};
