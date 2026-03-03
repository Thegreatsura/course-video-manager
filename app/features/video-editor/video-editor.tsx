import type { ClipSectionNamingModal } from "./types";
import { ClipSectionNamingModal as ClipSectionNamingModalComponent } from "./components/clip-section-naming-modal";
import { CreateVideoFromSelectionModal } from "./components/create-video-from-selection-modal";
import { VideoPlayerPanel } from "./components/video-player-panel";
import { ClipTimeline } from "./components/clip-timeline";
import { ErrorOverlay } from "./components/error-overlay";
import { RenameVideoModal } from "@/components/rename-video-modal";
import { useKeyboardShortcuts } from "./hooks/use-keyboard-shortcuts";
import { useWebSocket } from "./hooks/use-websocket";
import { useClipboardOperations } from "./hooks/use-clipboard-operations";
import { useCallback, useMemo, useState } from "react";
import { useFetcher, useRevalidator } from "react-router";
import { StandaloneFilePasteModal } from "@/components/standalone-file-paste-modal";
import { LessonFilePasteModal } from "@/components/lesson-file-paste-modal";
import { useEffectReducer } from "use-effect-reducer";
import type {
  Clip,
  EditorError,
  FrontendId,
  FrontendInsertionPoint,
  RecordingSession,
  TimelineItem,
} from "./clip-state-reducer";
import { isClip } from "./clip-utils";
import { type OBSConnectionOuterState } from "./obs-connector";
import { type FrontendSpeechDetectorState } from "./use-speech-detector";
import {
  makeVideoEditorReducer,
  type videoStateReducer,
} from "./video-state-reducer";
import {
  VideoEditorContext,
  type SuggestionState,
} from "./video-editor-context";
import {
  getClipsToAggressivelyPreload,
  getTotalDuration,
  getShowVideoPlayer,
  getShowLiveStream,
  getShowLastFrame,
  getDatabaseClipBeforeInsertionPoint,
  getTimelineItems,
  getSessionPanels,
  getCurrentClip,
  getAllClipsHaveSilenceDetected,
  getAllClipsHaveText,
  getClipComputedProps,
  getAreAnyClipsDangerous,
} from "./video-editor-selectors";

const useVideoEditor = (props: {
  items: TimelineItem[];
  clips: Clip[];
  insertionPoint: FrontendInsertionPoint;
  onClipsRemoved: (clipIds: FrontendId[]) => void;
  onClipsRetranscribe: (clipIds: FrontendId[]) => void;
  onToggleBeatForClip: (clipId: FrontendId) => void;
  onMoveClip: (clipId: FrontendId, direction: "up" | "down") => void;
  onAddClipSection: (name: string) => void;
  onUpdateClipSection: (clipSectionId: FrontendId, name: string) => void;
  onCreateVideoFromSelection: (
    clipIds: FrontendId[],
    clipSectionIds: FrontendId[],
    title: string,
    mode: "copy" | "move"
  ) => void;
}) => {
  const [state, dispatch] = useEffectReducer<
    videoStateReducer.State,
    videoStateReducer.Action,
    videoStateReducer.Effect
  >(
    makeVideoEditorReducer(
      props.items.map((item) => item.frontendId),
      props.clips.map((clip) => clip.frontendId)
    ),
    {
      showLastFrameOfVideo: true,
      runningState: "paused",
      currentClipId: props.clips[0]?.frontendId,
      currentTimeInClip: 0,
      selectedClipsSet: new Set<FrontendId>(),
      clipIdsPreloaded: new Set<FrontendId>(
        [props.clips[0]?.frontendId, props.clips[1]?.frontendId].filter(
          (id) => id !== undefined
        )
      ),
      playbackRate: 1,
    },
    {
      "archive-clips": (_state, effect, _dispatch) => {
        props.onClipsRemoved(effect.clipIds);
      },
      "retranscribe-clips": (_state, effect, _dispatch) => {
        props.onClipsRetranscribe(effect.clipIds);
      },
      "toggle-beat-for-clip": (_state, effect, _dispatch) => {
        props.onToggleBeatForClip(effect.clipId);
      },
      "move-clip": (_state, effect, _dispatch) => {
        props.onMoveClip(effect.clipId, effect.direction);
      },
      "create-video-from-selection": (_state, effect, _dispatch) => {
        props.onCreateVideoFromSelection(
          effect.clipIds,
          effect.clipSectionIds,
          effect.title,
          effect.mode
        );
      },
    }
  );

  return {
    state,
    dispatch,
  };
};

export const VideoEditor = (props: {
  obsConnectorState: OBSConnectionOuterState;
  items: TimelineItem[];
  sessions: RecordingSession[];
  videoPath: string;
  lessonPath?: string;
  repoName?: string;
  repoId?: string;
  lessonId?: string;
  videoId: string;
  liveMediaStream: MediaStream | null;
  speechDetectorState: FrontendSpeechDetectorState;
  clipIdsBeingTranscribed: Set<FrontendId>;
  onClipsRemoved: (clipIds: FrontendId[]) => void;
  onClipsRetranscribe: (clipIds: FrontendId[]) => void;
  hasExplainerFolder: boolean;
  videoCount: number;
  insertionPoint: FrontendInsertionPoint;
  onSetInsertionPoint: (mode: "after" | "before", clipId: FrontendId) => void;
  onDeleteLatestInsertedClip: () => void;
  onToggleBeat: () => void;
  onToggleBeatForClip: (clipId: FrontendId) => void;
  onMoveClip: (clipId: FrontendId, direction: "up" | "down") => void;
  onAddClipSection: (name: string) => void;
  onUpdateClipSection: (clipSectionId: FrontendId, name: string) => void;
  onAddClipSectionAt: (
    name: string,
    position: "before" | "after",
    itemId: FrontendId
  ) => void;
  error: EditorError | null;
  standaloneFiles: Array<{ path: string }>;
  files: Array<{ path: string; size: number; defaultEnabled: boolean }>;
  onCreateVideoFromSelection: (
    clipIds: FrontendId[],
    clipSectionIds: FrontendId[],
    title: string,
    mode: "copy" | "move"
  ) => void;
}) => {
  // Filter items for the main timeline (excludes optimistic clips and archived items)
  const timelineItems = useMemo(
    () => getTimelineItems(props.items),
    [props.items]
  );

  // Derive clips from timeline items for playback, timecodes, etc.
  const clips = useMemo(() => timelineItems.filter(isClip), [timelineItems]);

  // Derive session panel data for RecordingSessionPanel components
  const sessionPanels = useMemo(
    () => getSessionPanels(props.items, props.sessions),
    [props.items, props.sessions]
  );

  // Generate default name for new clip sections based on existing count
  const generateDefaultClipSectionName = () => {
    const existingClipSectionCount = timelineItems.filter(
      (item) =>
        item.type === "clip-section-on-database" ||
        item.type === "clip-section-optimistically-added"
    ).length;
    return `Section ${existingClipSectionCount + 1}`;
  };

  const { state, dispatch } = useVideoEditor({
    items: timelineItems,
    clips: clips,
    insertionPoint: props.insertionPoint,
    onClipsRemoved: props.onClipsRemoved,
    onClipsRetranscribe: props.onClipsRetranscribe,
    onToggleBeatForClip: props.onToggleBeatForClip,
    onMoveClip: props.onMoveClip,
    onAddClipSection: props.onAddClipSection,
    onUpdateClipSection: props.onUpdateClipSection,
    onCreateVideoFromSelection: props.onCreateVideoFromSelection,
  });

  const clipsToAggressivelyPreload = getClipsToAggressivelyPreload(
    state.currentClipId,
    clips,
    state.selectedClipsSet
  );

  const currentClipId = state.currentClipId;

  const exportToDavinciResolveFetcher = useFetcher();
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isAddVideoModalOpen, setIsAddVideoModalOpen] = useState(false);
  const [isPasteModalOpen, setIsPasteModalOpen] = useState(false);
  const [isRenameVideoModalOpen, setIsRenameVideoModalOpen] = useState(false);
  const [isCreateVideoModalOpen, setIsCreateVideoModalOpen] = useState(false);
  const revalidator = useRevalidator();

  // Suggestion state for sharing between SuggestionsPanel and ClipTimeline
  const [suggestionState, setSuggestionState] = useState<SuggestionState>({
    suggestionText: "",
    isStreaming: false,
    enabled: false,
    error: null,
    triggerSuggestion: () => {},
  });

  // State for clip section naming modal
  const [clipSectionNamingModal, setClipSectionNamingModal] =
    useState<ClipSectionNamingModal>(null);

  // Setup keyboard shortcuts
  useKeyboardShortcuts(dispatch);

  // Setup WebSocket connection for Stream Deck integration
  useWebSocket({
    dispatch,
    onDeleteLatestInsertedClip: props.onDeleteLatestInsertedClip,
    onToggleBeat: props.onToggleBeat,
    setClipSectionNamingModal,
    generateDefaultClipSectionName,
  });

  // Clipboard operations for transcript and YouTube chapters
  const {
    copyTranscriptToClipboard,
    copyYoutubeChaptersToClipboard,
    isCopied,
    isChaptersCopied,
    youtubeChapters,
  } = useClipboardOperations(timelineItems);

  const totalDuration = getTotalDuration(clips);

  const showVideoPlayer = getShowVideoPlayer(state.runningState);
  const showLiveStream = getShowLiveStream(
    !!props.liveMediaStream,
    state.runningState
  );
  const showLastFrame = getShowLastFrame(state.showLastFrameOfVideo);

  const databaseClipToShowLastFrameOf = getDatabaseClipBeforeInsertionPoint(
    timelineItems,
    props.insertionPoint
  );

  const currentClip = getCurrentClip(clips, currentClipId);

  const allClipsHaveSilenceDetected = getAllClipsHaveSilenceDetected(clips);

  const allClipsHaveText = getAllClipsHaveText(clips);

  const clipComputedProps = useMemo(() => getClipComputedProps(clips), [clips]);

  const areAnyClipsDangerous = getAreAnyClipsDangerous(clips);

  // Section modal management callbacks
  const onEditSection = useCallback(
    (sectionId: FrontendId, currentName: string) => {
      setClipSectionNamingModal({
        mode: "edit",
        clipSectionId: sectionId,
        currentName,
      });
    },
    []
  );

  const onAddSectionBefore = useCallback(
    (itemId: FrontendId, defaultName: string) => {
      setClipSectionNamingModal({
        mode: "add-at",
        position: "before",
        itemId,
        defaultName,
      });
    },
    []
  );

  const onAddSectionAfter = useCallback(
    (itemId: FrontendId, defaultName: string) => {
      setClipSectionNamingModal({
        mode: "add-at",
        position: "after",
        itemId,
        defaultName,
      });
    },
    []
  );

  const onAddIntroSection = useCallback(() => {
    props.onAddClipSection("Intro");
  }, [props]);

  const handlePasteModalClose = (open: boolean) => {
    setIsPasteModalOpen(open);
    if (!open) {
      // Revalidate to refresh the file list
      revalidator.revalidate();
    }
  };

  const handleFileCreated = () => {
    // File creation is handled by the modal, no additional action needed
    // Revalidation happens in handlePasteModalClose
  };

  const handleCreateVideoFromSelection = useCallback(
    (title: string, mode: "copy" | "move") => {
      dispatch({
        type: "create-video-from-selection-confirmed",
        title,
        mode,
      });
    },
    [dispatch]
  );

  // Build context value with all state and callbacks
  const contextValue = useMemo(
    () => ({
      // From videoStateReducer
      runningState: state.runningState,
      currentClipId: state.currentClipId,
      currentTimeInClip: state.currentTimeInClip,
      selectedClipsSet: state.selectedClipsSet,
      clipIdsPreloaded: state.clipIdsPreloaded,
      playbackRate: state.playbackRate,
      showLastFrameOfVideo: state.showLastFrameOfVideo,
      dispatch,

      // Computed
      clips,
      currentClip,
      currentClipProfile: currentClip?.profile ?? undefined,
      showVideoPlayer,
      showLiveStream,
      showLastFrame,
      clipComputedProps,
      totalDuration,
      clipsToAggressivelyPreload,
      allClipsHaveText,
      allClipsHaveSilenceDetected,
      areAnyClipsDangerous,
      databaseClipToShowLastFrameOf,

      // Route-level props
      items: timelineItems,
      sessions: props.sessions,
      sessionPanels,
      videoPath: props.videoPath,
      videoId: props.videoId,
      repoName: props.repoName,
      lessonPath: props.lessonPath,
      repoId: props.repoId,
      lessonId: props.lessonId,
      hasExplainerFolder: props.hasExplainerFolder,
      videoCount: props.videoCount,
      insertionPoint: props.insertionPoint,
      obsConnectorState: props.obsConnectorState,
      liveMediaStream: props.liveMediaStream,
      speechDetectorState: props.speechDetectorState,
      clipIdsBeingTranscribed: props.clipIdsBeingTranscribed,
      files: props.files,

      // Callbacks
      onSetInsertionPoint: props.onSetInsertionPoint,
      onMoveClip: props.onMoveClip,
      onToggleBeatForClip: props.onToggleBeatForClip,
      onAddClipSection: props.onAddClipSection,
      onUpdateClipSection: props.onUpdateClipSection,
      onAddClipSectionAt: props.onAddClipSectionAt,
      onClipFinished: () => {
        dispatch({ type: "clip-finished" });
      },
      onUpdateCurrentTime: (time: number) => {
        dispatch({ type: "update-clip-current-time", time });
      },
      onSectionClick: (sectionId: FrontendId, index: number) => {
        // Select the section
        dispatch({
          type: "click-clip",
          clipId: sectionId,
          ctrlKey: false,
          shiftKey: false,
        });

        // Scroll to the section in the timeline after React finishes re-rendering
        // Use the index to find the section since IDs change on re-render
        requestAnimationFrame(() => {
          const allSections = document.querySelectorAll('[id^="section-"]');
          if (allSections[index]) {
            allSections[index].scrollIntoView({
              behavior: "instant",
              block: "center",
            });
          }
        });
      },
      onAddIntroSection,
      onEditSection,
      onAddSectionBefore,
      onAddSectionAfter,
      generateDefaultClipSectionName,

      // Clipboard
      copyTranscriptToClipboard,
      copyYoutubeChaptersToClipboard,
      youtubeChapters,
      isCopied,
      isChaptersCopied,

      // Modal state (local useState, passed through context for access)
      exportToDavinciResolveFetcher,
      isExportModalOpen,
      setIsExportModalOpen,
      isAddVideoModalOpen,
      setIsAddVideoModalOpen,
      onAddNoteFromClipboard: () => setIsPasteModalOpen(true),
      isRenameVideoModalOpen,
      setIsRenameVideoModalOpen,
      isCreateVideoModalOpen,
      setIsCreateVideoModalOpen,

      // Suggestion state for inline display
      suggestionState,
      setSuggestionState,
    }),
    [
      state,
      dispatch,
      clips,
      currentClip,
      showVideoPlayer,
      showLiveStream,
      showLastFrame,
      clipComputedProps,
      totalDuration,
      clipsToAggressivelyPreload,
      allClipsHaveText,
      allClipsHaveSilenceDetected,
      areAnyClipsDangerous,
      databaseClipToShowLastFrameOf,
      props.items,
      props.videoPath,
      props.videoId,
      props.repoName,
      props.lessonPath,
      props.repoId,
      props.lessonId,
      props.hasExplainerFolder,
      props.videoCount,
      props.insertionPoint,
      props.obsConnectorState,
      props.liveMediaStream,
      props.speechDetectorState,
      props.clipIdsBeingTranscribed,
      props.files,
      props.onSetInsertionPoint,
      props.onMoveClip,
      props.onToggleBeatForClip,
      props.onAddClipSection,
      props.onUpdateClipSection,
      props.onAddClipSectionAt,
      copyTranscriptToClipboard,
      copyYoutubeChaptersToClipboard,
      youtubeChapters,
      isCopied,
      isChaptersCopied,
      exportToDavinciResolveFetcher,
      isExportModalOpen,
      setIsExportModalOpen,
      isAddVideoModalOpen,
      setIsAddVideoModalOpen,
      isRenameVideoModalOpen,
      setIsRenameVideoModalOpen,
      isCreateVideoModalOpen,
      setIsCreateVideoModalOpen,
      suggestionState,
      setSuggestionState,
      onAddIntroSection,
      onEditSection,
      onAddSectionBefore,
      onAddSectionAfter,
      generateDefaultClipSectionName,
    ]
  );

  // Show error overlay if there's a fatal error
  if (props.error) {
    return <ErrorOverlay error={props.error} />;
  }

  return (
    <div className="flex flex-col lg:flex-row p-6 gap-6 gap-y-10">
      {/* Video Player Section - Shows first on mobile, second on desktop */}
      <VideoEditorContext.Provider value={contextValue}>
        <VideoPlayerPanel />

        {/* Clip Section Naming Modal */}
        <ClipSectionNamingModalComponent
          modalState={clipSectionNamingModal}
          onClose={() => setClipSectionNamingModal(null)}
          onAddClipSection={props.onAddClipSection}
          onUpdateClipSection={props.onUpdateClipSection}
          onAddClipSectionAt={props.onAddClipSectionAt}
        />

        {/* File Paste Modal */}
        {props.lessonId ? (
          <LessonFilePasteModal
            videoId={props.videoId}
            open={isPasteModalOpen}
            onOpenChange={handlePasteModalClose}
            existingFiles={props.files}
            onFileCreated={handleFileCreated}
          />
        ) : (
          <StandaloneFilePasteModal
            videoId={props.videoId}
            open={isPasteModalOpen}
            onOpenChange={handlePasteModalClose}
            existingFiles={props.standaloneFiles}
            onFileCreated={handleFileCreated}
          />
        )}

        {/* Rename Video Modal */}
        <RenameVideoModal
          videoId={props.videoId}
          currentName={props.videoPath}
          open={isRenameVideoModalOpen}
          onOpenChange={setIsRenameVideoModalOpen}
        />

        {/* Create Video from Selection Modal */}
        <CreateVideoFromSelectionModal
          open={isCreateVideoModalOpen}
          onOpenChange={setIsCreateVideoModalOpen}
          onSubmit={handleCreateVideoFromSelection}
        />

        {/* Clips Section - Shows second on mobile, first on desktop */}
        <ClipTimeline />
      </VideoEditorContext.Provider>
    </div>
  );
};
