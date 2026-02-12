import { formatSecondsToTimeCode } from "@/services/utils";
import type { ClipSectionNamingModal, ClipComputedProps } from "./types";
import { ClipSectionNamingModal as ClipSectionNamingModalComponent } from "./components/clip-section-naming-modal";
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
import { useEffectReducer } from "use-effect-reducer";
import type {
  Clip,
  ClipOnDatabase,
  EditorError,
  FrontendId,
  FrontendInsertionPoint,
  TimelineItem,
} from "./clip-state-reducer";
import { calculateTextSimilarity, isClip } from "./clip-utils";
import { type OBSConnectionOuterState } from "./obs-connector";
import { type FrontendSpeechDetectorState } from "./use-speech-detector";
import {
  makeVideoEditorReducer,
  type videoStateReducer,
} from "./video-state-reducer";
import { VideoEditorContext } from "./video-editor-context";

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
}) => {
  // Filter items to get only clips (excluding clip sections)
  // Clip sections will be rendered separately in a future update
  const clips = useMemo(() => props.items.filter(isClip), [props.items]);

  // Generate default name for new clip sections based on existing count
  const generateDefaultClipSectionName = () => {
    const existingClipSectionCount = props.items.filter(
      (item) =>
        item.type === "clip-section-on-database" ||
        item.type === "clip-section-optimistically-added"
    ).length;
    return `Section ${existingClipSectionCount + 1}`;
  };

  const { state, dispatch } = useVideoEditor({
    items: props.items,
    clips: clips,
    insertionPoint: props.insertionPoint,
    onClipsRemoved: props.onClipsRemoved,
    onClipsRetranscribe: props.onClipsRetranscribe,
    onToggleBeatForClip: props.onToggleBeatForClip,
    onMoveClip: props.onMoveClip,
    onAddClipSection: props.onAddClipSection,
    onUpdateClipSection: props.onUpdateClipSection,
  });

  const currentClipIndex = clips.findIndex(
    (clip) => clip.frontendId === state.currentClipId
  );

  const nextClip = clips[currentClipIndex + 1];

  const selectedClipId = Array.from(state.selectedClipsSet)[0];

  const clipsToAggressivelyPreload = [
    state.currentClipId,
    nextClip?.frontendId,
    selectedClipId,
  ].filter((id) => id !== undefined) as FrontendId[];

  const currentClipId = state.currentClipId;

  const exportVideoClipsFetcher = useFetcher();
  const exportToDavinciResolveFetcher = useFetcher();
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isAddVideoModalOpen, setIsAddVideoModalOpen] = useState(false);
  const [isPasteModalOpen, setIsPasteModalOpen] = useState(false);
  const [isRenameVideoModalOpen, setIsRenameVideoModalOpen] = useState(false);
  const revalidator = useRevalidator();

  // Suggestion state for sharing between SuggestionsPanel and ClipTimeline
  const [suggestionState, setSuggestionState] = useState({
    suggestionText: "",
    isStreaming: false,
    enabled: false,
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
  } = useClipboardOperations(props.items);

  const totalDuration = clips.reduce((acc, clip) => {
    if (clip.type === "on-database") {
      return acc + (clip.sourceEndTime - clip.sourceStartTime);
    }
    return acc;
  }, 0);

  let viewMode: "video-player" | "live-stream" | "last-frame" = "video-player";

  if (state.showLastFrameOfVideo) {
    viewMode = "last-frame";
  } else if (!props.liveMediaStream || state.runningState === "playing") {
    viewMode = "video-player";
  } else {
    viewMode = "live-stream";
  }

  const databaseClipToShowLastFrameOf = getDatabaseClipBeforeInsertionPoint(
    clips,
    props.insertionPoint
  );

  const currentClip = clips.find((clip) => clip.frontendId === currentClipId);

  const allClipsHaveSilenceDetected = clips.every(
    (clip) => clip.type === "on-database"
  );

  const allClipsHaveText = clips.every(
    (clip) => clip.type === "on-database" && clip.text
  );

  // Create a map of clip frontendId -> computed properties (timecode, levenshtein)
  const clipComputedProps = useMemo(() => {
    let timecode = 0;
    const map: ClipComputedProps = new Map();

    clips.forEach((clip, index) => {
      if (clip.type === "optimistically-added") {
        map.set(clip.frontendId, { timecode: "", nextLevenshtein: 0 });
        return;
      }

      const nextClip = clips[index + 1];

      const nextLevenshtein =
        nextClip?.type === "on-database" && nextClip?.text
          ? calculateTextSimilarity(clip.text, nextClip.text)
          : 0;

      const timecodeString = formatSecondsToTimeCode(timecode);

      const duration = clip.sourceEndTime - clip.sourceStartTime;
      timecode += duration;

      map.set(clip.frontendId, { timecode: timecodeString, nextLevenshtein });
    });

    return map;
  }, [clips]);

  const areAnyClipsDangerous = clips.some((clip) => {
    if (clip.type !== "on-database") return false;
    const props = clipComputedProps.get(clip.frontendId);
    return props && props.nextLevenshtein > DANGEROUS_TEXT_SIMILARITY_THRESHOLD;
  });

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
      viewMode,
      clipComputedProps,
      totalDuration,
      clipsToAggressivelyPreload,
      allClipsHaveText,
      allClipsHaveSilenceDetected,
      areAnyClipsDangerous,
      databaseClipToShowLastFrameOf,

      // Route-level props
      items: props.items,
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
      exportVideoClipsFetcher,
      exportToDavinciResolveFetcher,
      isExportModalOpen,
      setIsExportModalOpen,
      isAddVideoModalOpen,
      setIsAddVideoModalOpen,
      onAddNoteFromClipboard: () => setIsPasteModalOpen(true),
      isRenameVideoModalOpen,
      setIsRenameVideoModalOpen,

      // Suggestion state for inline display
      suggestionState,
      setSuggestionState,
    }),
    [
      state,
      dispatch,
      clips,
      currentClip,
      viewMode,
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
      exportVideoClipsFetcher,
      exportToDavinciResolveFetcher,
      isExportModalOpen,
      setIsExportModalOpen,
      isAddVideoModalOpen,
      setIsAddVideoModalOpen,
      isRenameVideoModalOpen,
      setIsRenameVideoModalOpen,
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

        {/* Standalone File Paste Modal */}
        <StandaloneFilePasteModal
          videoId={props.videoId}
          open={isPasteModalOpen}
          onOpenChange={handlePasteModalClose}
          existingFiles={props.standaloneFiles}
          onFileCreated={handleFileCreated}
        />

        {/* Rename Video Modal */}
        <RenameVideoModal
          videoId={props.videoId}
          currentName={props.videoPath}
          open={isRenameVideoModalOpen}
          onOpenChange={setIsRenameVideoModalOpen}
        />

        {/* Clips Section - Shows second on mobile, first on desktop */}
        <ClipTimeline />
      </VideoEditorContext.Provider>
    </div>
  );
};

const DANGEROUS_TEXT_SIMILARITY_THRESHOLD = 40;

export const getDatabaseClipBeforeInsertionPoint = (
  clips: Clip[],
  insertionPoint: FrontendInsertionPoint
): ClipOnDatabase | undefined => {
  if (insertionPoint.type === "start") {
    return undefined;
  }

  if (insertionPoint.type === "end") {
    return clips.findLast((clip) => clip.type === "on-database");
  }

  if (insertionPoint.type === "after-clip") {
    return clips.find(
      (clip) =>
        clip.frontendId === insertionPoint.frontendClipId &&
        clip.type === "on-database"
    ) as ClipOnDatabase | undefined;
  }
};
