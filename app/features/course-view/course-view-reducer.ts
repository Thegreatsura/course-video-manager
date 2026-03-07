import type { EffectReducer } from "use-effect-reducer";

export namespace courseViewReducer {
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
    // Boolean modal toggles
    isAddRepoModalOpen: boolean;
    isCreateSectionModalOpen: boolean;
    isCreateVersionModalOpen: boolean;
    isVersionSelectorModalOpen: boolean;
    isEditVersionModalOpen: boolean;
    isRenameRepoModalOpen: boolean;
    isDeleteVersionModalOpen: boolean;
    isClearVideoFilesModalOpen: boolean;
    isRewriteRepoPathModalOpen: boolean;
    isAddStandaloneVideoModalOpen: boolean;

    // ID-based selection states (null = closed)
    addGhostLessonSectionId: string | null;
    addVideoToLessonId: string | null;
    editLessonId: string | null;
    convertToGhostLessonId: string | null;

    // Complex object states
    videoPlayerState: VideoPlayerState;
    moveVideoState: MoveVideoState;
    moveLessonState: MoveLessonState;
    renameVideoState: RenameVideoState;

    // Filter states
    priorityFilter: number[];
    iconFilter: string[];
    fsStatusFilter: string[];
  };

  export type Action =
    // Boolean modal toggles
    | { type: "set-add-repo-modal-open"; open: boolean }
    | { type: "set-create-section-modal-open"; open: boolean }
    | { type: "set-create-version-modal-open"; open: boolean }
    | { type: "set-version-selector-modal-open"; open: boolean }
    | { type: "set-edit-version-modal-open"; open: boolean }
    | { type: "set-rename-repo-modal-open"; open: boolean }
    | { type: "set-delete-version-modal-open"; open: boolean }
    | { type: "set-clear-video-files-modal-open"; open: boolean }
    | { type: "set-rewrite-repo-path-modal-open"; open: boolean }
    | { type: "set-add-standalone-video-modal-open"; open: boolean }
    // ID-based selections
    | { type: "set-add-ghost-lesson-section-id"; sectionId: string | null }
    | { type: "set-add-video-to-lesson-id"; lessonId: string | null }
    | { type: "set-edit-lesson-id"; lessonId: string | null }
    | { type: "set-convert-to-ghost-lesson-id"; lessonId: string | null }
    // Video player
    | {
        type: "open-video-player";
        videoId: string;
        videoPath: string;
      }
    | { type: "close-video-player" }
    // Move video
    | {
        type: "open-move-video";
        videoId: string;
        videoPath: string;
        currentLessonId: string;
      }
    | { type: "close-move-video" }
    // Move lesson
    | {
        type: "open-move-lesson";
        lessonId: string;
        lessonTitle: string;
        currentSectionId: string;
      }
    | { type: "close-move-lesson" }
    // Rename video
    | { type: "open-rename-video"; videoId: string; videoPath: string }
    | { type: "close-rename-video" }
    // Filters
    | { type: "toggle-priority-filter"; priority: number }
    | { type: "toggle-icon-filter"; icon: string }
    | { type: "toggle-fs-status-filter"; status: string };

  export type Effect = never;
}

export function createInitialCourseViewState(): courseViewReducer.State {
  return {
    isAddRepoModalOpen: false,
    isCreateSectionModalOpen: false,
    isCreateVersionModalOpen: false,
    isVersionSelectorModalOpen: false,
    isEditVersionModalOpen: false,
    isRenameRepoModalOpen: false,
    isDeleteVersionModalOpen: false,
    isClearVideoFilesModalOpen: false,
    isRewriteRepoPathModalOpen: false,
    isAddStandaloneVideoModalOpen: false,
    addGhostLessonSectionId: null,
    addVideoToLessonId: null,
    editLessonId: null,
    convertToGhostLessonId: null,
    videoPlayerState: { isOpen: false, videoId: "", videoPath: "" },
    moveVideoState: null,
    moveLessonState: null,
    renameVideoState: null,
    priorityFilter: [],
    iconFilter: [],
    fsStatusFilter: [],
  };
}

export const courseViewReducer: EffectReducer<
  courseViewReducer.State,
  courseViewReducer.Action,
  courseViewReducer.Effect
> = (state, action) => {
  switch (action.type) {
    // Boolean modal toggles
    case "set-add-repo-modal-open":
      return { ...state, isAddRepoModalOpen: action.open };
    case "set-create-section-modal-open":
      return { ...state, isCreateSectionModalOpen: action.open };
    case "set-create-version-modal-open":
      return { ...state, isCreateVersionModalOpen: action.open };
    case "set-version-selector-modal-open":
      return { ...state, isVersionSelectorModalOpen: action.open };
    case "set-edit-version-modal-open":
      return { ...state, isEditVersionModalOpen: action.open };
    case "set-rename-repo-modal-open":
      return { ...state, isRenameRepoModalOpen: action.open };
    case "set-delete-version-modal-open":
      return { ...state, isDeleteVersionModalOpen: action.open };
    case "set-clear-video-files-modal-open":
      return { ...state, isClearVideoFilesModalOpen: action.open };
    case "set-rewrite-repo-path-modal-open":
      return { ...state, isRewriteRepoPathModalOpen: action.open };
    case "set-add-standalone-video-modal-open":
      return { ...state, isAddStandaloneVideoModalOpen: action.open };

    // ID-based selections
    case "set-add-ghost-lesson-section-id":
      return { ...state, addGhostLessonSectionId: action.sectionId };
    case "set-add-video-to-lesson-id":
      return { ...state, addVideoToLessonId: action.lessonId };
    case "set-edit-lesson-id":
      return { ...state, editLessonId: action.lessonId };
    case "set-convert-to-ghost-lesson-id":
      return { ...state, convertToGhostLessonId: action.lessonId };

    // Video player
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

    // Move video
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

    // Move lesson
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

    // Rename video
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

    // Filters
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
        fsStatusFilter: state.fsStatusFilter.includes(action.status)
          ? state.fsStatusFilter.filter((s) => s !== action.status)
          : [...state.fsStatusFilter, action.status],
      };
  }
};
