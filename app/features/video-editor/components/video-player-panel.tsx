import { AddVideoModal } from "@/components/add-video-modal";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { formatSecondsToTimeCode } from "@/services/utils";
import { LiveMediaStream } from "./live-media-stream";
import { RecordingSignalIndicator } from "./timeline-indicators";
import { TableOfContents } from "./table-of-contents";
import { SuggestionsPanel } from "./suggestions-panel";
import { ActionsDropdown } from "./actions-dropdown";
import { isClipSection } from "../clip-utils";
import { PreloadableClipManager } from "../preloadable-clip";
import { AlertTriangleIcon, ChevronLeftIcon } from "lucide-react";
import { Link, useFetcher } from "react-router";
import { useContextSelector } from "use-context-selector";
import {
  VideoEditorContext,
  type SuggestionState,
} from "../video-editor-context";
import { useState, useMemo, useCallback } from "react";

/**
 * Video player panel component displaying video preview, controls, and metadata.
 * Includes live stream, video player, table of contents, and action buttons.
 */
export const VideoPlayerPanel = () => {
  // Use context selectors for all state
  const videoPath = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.videoPath
  );
  const totalDuration = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.totalDuration
  );
  const areAnyClipsDangerous = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.areAnyClipsDangerous
  );
  const repoName = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.repoName
  );
  const lessonPath = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.lessonPath
  );
  const repoId = useContextSelector(VideoEditorContext, (ctx) => ctx.repoId);
  const lessonId = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.lessonId
  );
  const liveMediaStream = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.liveMediaStream
  );
  const viewMode = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.viewMode
  );
  const obsConnectorState = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.obsConnectorState
  );
  const speechDetectorState = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.speechDetectorState
  );
  const databaseClipToShowLastFrameOf = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.databaseClipToShowLastFrameOf
  );
  const clipsToAggressivelyPreload = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.clipsToAggressivelyPreload
  );
  const clips = useContextSelector(VideoEditorContext, (ctx) => ctx.clips);
  const insertionPoint = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.insertionPoint
  );
  const clipIdsPreloaded = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.clipIdsPreloaded
  );
  const runningState = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.runningState
  );
  const currentClipId = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.currentClipId
  );
  const currentClipProfile = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.currentClipProfile
  );
  const onClipFinished = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.onClipFinished
  );
  const onUpdateCurrentTime = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.onUpdateCurrentTime
  );
  const playbackRate = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.playbackRate
  );
  const allClipsHaveSilenceDetected = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.allClipsHaveSilenceDetected
  );
  const allClipsHaveText = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.allClipsHaveText
  );
  const exportVideoClipsFetcher = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.exportVideoClipsFetcher
  );
  const exportToDavinciResolveFetcher = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.exportToDavinciResolveFetcher
  );
  const videoId = useContextSelector(VideoEditorContext, (ctx) => ctx.videoId);
  const isExportModalOpen = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.isExportModalOpen
  );
  const setIsExportModalOpen = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.setIsExportModalOpen
  );
  const isCopied = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.isCopied
  );
  const copyTranscriptToClipboard = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.copyTranscriptToClipboard
  );
  const youtubeChapters = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.youtubeChapters
  );
  const isChaptersCopied = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.isChaptersCopied
  );
  const copyYoutubeChaptersToClipboard = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.copyYoutubeChaptersToClipboard
  );
  const isAddVideoModalOpen = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.isAddVideoModalOpen
  );
  const setIsAddVideoModalOpen = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.setIsAddVideoModalOpen
  );
  const onAddNoteFromClipboard = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.onAddNoteFromClipboard
  );
  const setIsRenameVideoModalOpen = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.setIsRenameVideoModalOpen
  );
  const items = useContextSelector(VideoEditorContext, (ctx) => ctx.items);
  const files = useContextSelector(VideoEditorContext, (ctx) => ctx.files);
  const selectedClipsSet = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.selectedClipsSet
  );
  const onSectionClick = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.onSectionClick
  );
  const videoCount = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.videoCount
  );
  const hasExplainerFolder = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.hasExplainerFolder
  );
  const revealVideoFetcher = useFetcher();

  const [activeTab, setActiveTab] = useState<"suggestions" | "toc">(
    "suggestions"
  );

  // Suggestion state from context (shared with ClipTimeline)
  const setSuggestionState = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.setSuggestionState
  );

  const handleSuggestionStateChange = useCallback(
    (state: SuggestionState) => {
      setSuggestionState(state);
    },
    [setSuggestionState]
  );

  // Get the last clip with text (transcription completed) for suggestions trigger
  const lastTranscribedClipId = useMemo(() => {
    const clipsWithText = clips.filter(
      (clip) => clip.type === "on-database" && clip.text
    );
    return clipsWithText.length > 0
      ? clipsWithText[clipsWithText.length - 1]!.frontendId
      : null;
  }, [clips]);

  const clipSections = items.filter(isClipSection);
  const hasSections = clipSections.length > 0;

  return (
    <>
      <div className="lg:flex-1 relative order-1 lg:order-2">
        <div className="sticky top-6">
          <div className="">
            <div className="mb-4">
              <h1 className="text-2xl font-bold mb-1 flex items-center">
                {videoPath}
                {" (" + formatSecondsToTimeCode(totalDuration) + ")"}
                {areAnyClipsDangerous && (
                  <span className="text-orange-500 ml-4 text-base font-medium inline-flex items-center">
                    <AlertTriangleIcon className="size-6 mr-2" />
                    Possible duplicate clips
                  </span>
                )}
              </h1>
              {repoName && lessonPath && (
                <h2 className="text-sm font-medium mb-1">
                  {repoName}
                  {" - "}
                  {lessonPath}
                </h2>
              )}
            </div>

            {liveMediaStream && (
              <div
                className={cn(
                  "w-full h-full relative aspect-[16/9]",
                  (obsConnectorState.type === "obs-connected" ||
                    obsConnectorState.type === "obs-recording") &&
                    obsConnectorState.profile === "TikTok" &&
                    "w-92 aspect-[9/16]",
                  "hidden",
                  (viewMode === "live-stream" || viewMode === "last-frame") &&
                    "block"
                )}
              >
                {obsConnectorState.type === "obs-recording" && (
                  <RecordingSignalIndicator />
                )}

                {(obsConnectorState.type === "obs-recording" ||
                  obsConnectorState.type === "obs-connected") && (
                  <LiveMediaStream
                    mediaStream={liveMediaStream}
                    obsConnectorState={obsConnectorState}
                    speechDetectorState={speechDetectorState}
                    showCenterLine={obsConnectorState.scene === "Camera"}
                  />
                )}
                {databaseClipToShowLastFrameOf &&
                  viewMode === "last-frame" &&
                  // Only show overlay if scenes match, or if no scene is detected
                  (obsConnectorState.type !== "obs-recording" &&
                  obsConnectorState.type !== "obs-connected"
                    ? true // Default to showing if OBS not connected
                    : databaseClipToShowLastFrameOf.scene === null ||
                      databaseClipToShowLastFrameOf.scene ===
                        obsConnectorState.scene) && (
                    <div
                      className={cn(
                        "absolute top-0 left-0 rounded-lg",
                        databaseClipToShowLastFrameOf.profile === "TikTok" &&
                          "w-92 aspect-[9/16]"
                      )}
                    >
                      <img
                        className="w-full h-full rounded-lg opacity-50"
                        src={`/clips/${databaseClipToShowLastFrameOf.databaseId}/last-frame`}
                      />
                    </div>
                  )}
              </div>
            )}
            <div
              className={cn(
                "w-full aspect-[16/9]",
                viewMode !== "video-player" && "hidden"
              )}
            >
              <PreloadableClipManager
                clipsToAggressivelyPreload={clipsToAggressivelyPreload}
                clips={clips
                  .filter((clip) => clipIdsPreloaded.has(clip.frontendId))
                  .filter((clip) => clip.type === "on-database")}
                finalClipId={clips[clips.length - 1]?.frontendId}
                state={runningState}
                currentClipId={currentClipId}
                currentClipProfile={currentClipProfile}
                onClipFinished={onClipFinished}
                onUpdateCurrentTime={onUpdateCurrentTime}
                playbackRate={playbackRate}
              />
            </div>

            <div className="flex gap-2 mt-4">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      asChild={allClipsHaveSilenceDetected}
                      variant="secondary"
                      aria-label="Go Back"
                      disabled={!allClipsHaveSilenceDetected}
                    >
                      {allClipsHaveSilenceDetected ? (
                        <Link
                          to={
                            repoId && lessonId
                              ? `/?repoId=${repoId}#${lessonId}`
                              : "/videos"
                          }
                        >
                          <ChevronLeftIcon className="w-4 h-4" />
                        </Link>
                      ) : (
                        <span>
                          <ChevronLeftIcon className="w-4 h-4" />
                        </span>
                      )}
                    </Button>
                  </TooltipTrigger>
                  {!allClipsHaveSilenceDetected && (
                    <TooltipContent>
                      <p>Waiting for silence detection to complete</p>
                    </TooltipContent>
                  )}
                </Tooltip>

                <ActionsDropdown
                  allClipsHaveSilenceDetected={allClipsHaveSilenceDetected}
                  allClipsHaveText={allClipsHaveText}
                  exportVideoClipsFetcher={exportVideoClipsFetcher}
                  exportToDavinciResolveFetcher={exportToDavinciResolveFetcher}
                  videoId={videoId}
                  lessonId={lessonId}
                  isExportModalOpen={isExportModalOpen}
                  setIsExportModalOpen={setIsExportModalOpen}
                  isCopied={isCopied}
                  copyTranscriptToClipboard={copyTranscriptToClipboard}
                  youtubeChapters={youtubeChapters}
                  isChaptersCopied={isChaptersCopied}
                  copyYoutubeChaptersToClipboard={
                    copyYoutubeChaptersToClipboard
                  }
                  onAddVideoClick={() => setIsAddVideoModalOpen(true)}
                  onAddNoteFromClipboard={onAddNoteFromClipboard}
                  onRenameVideoClick={() => setIsRenameVideoModalOpen(true)}
                  onRevealInFileSystem={() => {
                    revealVideoFetcher.submit(
                      {},
                      {
                        method: "post",
                        action: `/api/videos/${videoId}/reveal`,
                      }
                    );
                  }}
                />
              </TooltipProvider>
            </div>

            {/* Tabbed panel for Suggestions and Table of Contents */}
            <div className="mt-6 border-t border-gray-700 pt-4">
              <div className="flex gap-2 mb-3">
                <button
                  onClick={() => setActiveTab("suggestions")}
                  className={cn(
                    "px-3 py-1.5 text-sm font-medium rounded transition-colors",
                    activeTab === "suggestions"
                      ? "bg-gray-700 text-white"
                      : "text-gray-400 hover:text-gray-200"
                  )}
                >
                  Suggestions
                </button>
                {hasSections && (
                  <button
                    onClick={() => setActiveTab("toc")}
                    className={cn(
                      "px-3 py-1.5 text-sm font-medium rounded transition-colors",
                      activeTab === "toc"
                        ? "bg-gray-700 text-white"
                        : "text-gray-400 hover:text-gray-200"
                    )}
                  >
                    Sections
                  </button>
                )}
              </div>

              {activeTab === "suggestions" && (
                <SuggestionsPanel
                  videoId={videoId}
                  lastTranscribedClipId={lastTranscribedClipId}
                  clips={clips}
                  insertionPoint={insertionPoint}
                  files={files}
                  onSuggestionStateChange={handleSuggestionStateChange}
                />
              )}

              {activeTab === "toc" && hasSections && (
                <TableOfContents
                  clipSections={clipSections}
                  selectedClipsSet={selectedClipsSet}
                  onSectionClick={onSectionClick}
                />
              )}
            </div>
          </div>
        </div>
      </div>

      <AddVideoModal
        lessonId={lessonId}
        videoCount={videoCount}
        hasExplainerFolder={hasExplainerFolder}
        open={isAddVideoModalOpen}
        onOpenChange={setIsAddVideoModalOpen}
      />
    </>
  );
};
