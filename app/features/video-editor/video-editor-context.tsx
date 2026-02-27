import { createContext } from "use-context-selector";
import type {
  Clip,
  ClipOnDatabase,
  FrontendId,
  FrontendInsertionPoint,
  TimelineItem,
} from "./clip-state-reducer";
import type { videoStateReducer } from "./video-state-reducer";
import type { OBSConnectionOuterState } from "./obs-connector";
import type { FrontendSpeechDetectorState } from "./use-speech-detector";
import type { ClipComputedProps } from "./types";
import type { FetcherWithComponents } from "react-router";

export type FileMetadata = {
  path: string;
  size: number;
  defaultEnabled: boolean;
};

export type SuggestionState = {
  suggestionText: string;
  isStreaming: boolean;
  enabled: boolean;
  error: Error | null;
  triggerSuggestion: () => void;
};

export type VideoEditorContextType = {
  // From videoStateReducer
  runningState: "playing" | "paused";
  currentClipId: FrontendId | undefined;
  currentTimeInClip: number;
  selectedClipsSet: Set<FrontendId>;
  clipIdsPreloaded: Set<FrontendId>;
  playbackRate: number;
  showLastFrameOfVideo: boolean;
  dispatch: (action: videoStateReducer.Action) => void;

  // Computed
  clips: Clip[];
  currentClip: Clip | undefined;
  currentClipProfile: string | undefined;
  showVideoPlayer: boolean;
  showLiveStream: boolean;
  showLastFrame: boolean;
  clipComputedProps: ClipComputedProps;
  totalDuration: number;
  clipsToAggressivelyPreload: FrontendId[];
  allClipsHaveText: boolean;
  allClipsHaveSilenceDetected: boolean;
  areAnyClipsDangerous: boolean;
  databaseClipToShowLastFrameOf: ClipOnDatabase | undefined;

  // Route-level props
  items: TimelineItem[];
  videoPath: string;
  videoId: string;
  repoName?: string;
  lessonPath?: string;
  repoId?: string;
  lessonId?: string;
  hasExplainerFolder: boolean;
  videoCount: number;
  insertionPoint: FrontendInsertionPoint;
  obsConnectorState: OBSConnectionOuterState;
  liveMediaStream: MediaStream | null;
  speechDetectorState: FrontendSpeechDetectorState;
  clipIdsBeingTranscribed: Set<FrontendId>;
  files: FileMetadata[];

  // Callbacks
  onSetInsertionPoint: (mode: "after" | "before", clipId: FrontendId) => void;
  onMoveClip: (clipId: FrontendId, direction: "up" | "down") => void;
  onToggleBeatForClip: (clipId: FrontendId) => void;
  onAddClipSection: (name: string) => void;
  onUpdateClipSection: (clipSectionId: FrontendId, name: string) => void;
  onAddClipSectionAt: (
    name: string,
    position: "before" | "after",
    itemId: FrontendId
  ) => void;
  onClipFinished: () => void;
  onUpdateCurrentTime: (time: number) => void;
  onSectionClick: (sectionId: FrontendId, index: number) => void;
  onAddIntroSection: () => void;
  onEditSection: (sectionId: FrontendId, currentName: string) => void;
  onAddSectionBefore: (itemId: FrontendId, defaultName: string) => void;
  onAddSectionAfter: (itemId: FrontendId, defaultName: string) => void;
  generateDefaultClipSectionName: () => string;

  // Clipboard
  copyTranscriptToClipboard: () => Promise<void>;
  copyYoutubeChaptersToClipboard: () => Promise<void>;
  youtubeChapters: { timestamp: string; name: string }[];
  isCopied: boolean;
  isChaptersCopied: boolean;

  // Modal state (local useState, passed through context for access)
  exportToDavinciResolveFetcher: FetcherWithComponents<unknown>;
  isExportModalOpen: boolean;
  setIsExportModalOpen: (value: boolean) => void;
  isAddVideoModalOpen: boolean;
  setIsAddVideoModalOpen: (value: boolean) => void;
  onAddNoteFromClipboard: () => void;
  isRenameVideoModalOpen: boolean;
  setIsRenameVideoModalOpen: (value: boolean) => void;
  isCreateVideoModalOpen: boolean;
  setIsCreateVideoModalOpen: (value: boolean) => void;

  // Suggestion state for inline display
  suggestionState: SuggestionState;
  setSuggestionState: (state: SuggestionState) => void;
};

export const VideoEditorContext = createContext<VideoEditorContextType>(null!);
