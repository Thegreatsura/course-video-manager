import type { EffectReducer } from "use-effect-reducer";
import type {
  FrontendId,
  DatabaseId,
  EditorSection,
} from "./course-editor-types";
import type { Lesson } from "@/features/course-view/course-view-types";

// ============================================================================
// Namespace: State, Action, Effect
// ============================================================================

export namespace courseEditorReducer {
  // --------------------------------------------------------------------------
  // Sub-types used in state
  // --------------------------------------------------------------------------

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

  // --------------------------------------------------------------------------
  // State
  // --------------------------------------------------------------------------

  export type State = {
    // Entity state (owned by reducer after initialization)
    sections: EditorSection[];

    // Boolean modal toggles
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

    // ID-based selection states (use FrontendId for stable references)
    addGhostLessonSectionId: FrontendId | null;
    insertAdjacentLessonId: FrontendId | null;
    insertPosition: "before" | "after" | null;
    addVideoToLessonId: FrontendId | null;
    editLessonId: FrontendId | null;
    editSectionId: FrontendId | null;
    convertToGhostLessonId: FrontendId | null;
    deleteLessonId: FrontendId | null;
    deleteSectionId: FrontendId | null;
    createOnDiskLessonId: FrontendId | null;

    // Complex object states
    videoPlayerState: VideoPlayerState;
    moveVideoState: MoveVideoState;
    moveLessonState: MoveLessonState;
    renameVideoState: RenameVideoState;

    // Filter states
    priorityFilter: number[];
    iconFilter: string[];
    fsStatusFilter: string | null;
    searchQuery: string;
  };

  // --------------------------------------------------------------------------
  // Actions
  // --------------------------------------------------------------------------

  export type Action =
    // === Section entity actions ===
    | { type: "add-section"; title: string; repoVersionId: string }
    | { type: "rename-section"; frontendId: FrontendId; title: string }
    | { type: "delete-section"; frontendId: FrontendId }
    | { type: "reorder-sections"; frontendIds: FrontendId[] }
    // === Reconciliation actions (dispatched by effect queue) ===
    | {
        type: "section-created";
        frontendId: FrontendId;
        databaseId: DatabaseId;
        path: string;
      }
    | { type: "section-renamed"; frontendId: FrontendId; path: string }
    | { type: "section-deleted"; frontendId: FrontendId }
    | { type: "sections-reordered" }
    // === Boolean modal toggles ===
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
    // === ID-based selections ===
    | {
        type: "set-add-lesson-section-id";
        sectionId: FrontendId | null;
      }
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
    | { type: "set-delete-section-id"; sectionId: FrontendId | null }
    | {
        type: "set-create-on-disk-lesson-id";
        lessonId: FrontendId | null;
      }
    // === Video player ===
    | { type: "open-video-player"; videoId: string; videoPath: string }
    | { type: "close-video-player" }
    // === Move video ===
    | {
        type: "open-move-video";
        videoId: string;
        videoPath: string;
        currentLessonId: string;
      }
    | { type: "close-move-video" }
    // === Move lesson ===
    | {
        type: "open-move-lesson";
        lessonId: string;
        lessonTitle: string;
        currentSectionId: string;
      }
    | { type: "close-move-lesson" }
    // === Rename video ===
    | { type: "open-rename-video"; videoId: string; videoPath: string }
    | { type: "close-rename-video" }
    // === Filters ===
    | { type: "toggle-priority-filter"; priority: number }
    | { type: "toggle-icon-filter"; icon: string }
    | { type: "toggle-fs-status-filter"; status: string }
    | { type: "set-search-query"; query: string };

  // --------------------------------------------------------------------------
  // Effects
  // --------------------------------------------------------------------------

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
        type: "delete-section";
        frontendId: FrontendId;
        sectionId: FrontendId | DatabaseId;
      }
    | {
        type: "reorder-sections";
        sectionIds: (FrontendId | DatabaseId)[];
      };
}

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

// ============================================================================
// Initial State Factory
// ============================================================================

export function createInitialCourseEditorState(
  sections: EditorSection[] = []
): courseEditorReducer.State {
  return {
    sections,
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
    deleteSectionId: null,
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
  switch (action.type) {
    // ========================================================================
    // Section entity actions
    // ========================================================================

    case "add-section": {
      const frontendId = generateFrontendId();
      const maxOrder = state.sections.reduce(
        (max, s) => Math.max(max, s.order),
        0
      );
      const newOrder = maxOrder + 1;
      const slug = toSlug(action.title.trim()) || "untitled";

      const newSection: EditorSection = {
        frontendId,
        databaseId: null,
        repoVersionId: action.repoVersionId,
        path: slug,
        order: newOrder,
        lessons: [],
      };

      exec({
        type: "create-section",
        frontendId,
        repoVersionId: action.repoVersionId,
        title: action.title,
        maxOrder,
      });

      return {
        ...state,
        sections: [...state.sections, newSection],
      };
    }

    case "rename-section": {
      const section = state.sections.find(
        (s) => s.frontendId === action.frontendId
      );
      if (!section) return state;

      const slug = toSlug(action.title.trim()) || "untitled";
      const sectionId = section.databaseId ?? section.frontendId;

      exec({
        type: "rename-section",
        frontendId: action.frontendId,
        sectionId,
        title: action.title,
      });

      return {
        ...state,
        sections: state.sections.map((s) =>
          s.frontendId === action.frontendId ? { ...s, path: slug } : s
        ),
      };
    }

    case "delete-section": {
      const section = state.sections.find(
        (s) => s.frontendId === action.frontendId
      );
      if (!section) return state;

      const sectionId = section.databaseId ?? section.frontendId;

      exec({
        type: "delete-section",
        frontendId: action.frontendId,
        sectionId,
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

      const sectionIds = reordered.map((s) => s.databaseId ?? s.frontendId);

      exec({
        type: "reorder-sections",
        sectionIds,
      });

      return {
        ...state,
        sections: reordered,
      };
    }

    // ========================================================================
    // Reconciliation actions
    // ========================================================================

    case "section-created": {
      return {
        ...state,
        sections: state.sections.map((s) =>
          s.frontendId === action.frontendId
            ? { ...s, databaseId: action.databaseId, path: action.path }
            : s
        ),
      };
    }

    case "section-renamed": {
      return {
        ...state,
        sections: state.sections.map((s) =>
          s.frontendId === action.frontendId ? { ...s, path: action.path } : s
        ),
      };
    }

    case "section-deleted":
    case "sections-reordered": {
      // No state change needed — optimistic state is already correct
      return state;
    }

    // ========================================================================
    // Boolean modal toggles
    // ========================================================================

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

    // ========================================================================
    // ID-based selections
    // ========================================================================

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
    case "set-delete-section-id":
      return { ...state, deleteSectionId: action.sectionId };
    case "set-create-on-disk-lesson-id":
      return { ...state, createOnDiskLessonId: action.lessonId };

    // ========================================================================
    // Video player
    // ========================================================================

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

    // ========================================================================
    // Move video
    // ========================================================================

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

    // ========================================================================
    // Move lesson
    // ========================================================================

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

    // ========================================================================
    // Rename video
    // ========================================================================

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

    // ========================================================================
    // Filters
    // ========================================================================

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
  }
};
