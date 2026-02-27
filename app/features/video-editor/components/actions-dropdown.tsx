import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ExportModal } from "./export-modal";
import {
  CheckIcon,
  ChevronDown,
  ClipboardIcon,
  CopyIcon,
  FilmIcon,
  FolderOpen,
  Loader2,
  PencilLineIcon,
  Plus,
  ScrollTextIcon,
} from "lucide-react";
import { type FetcherWithComponents } from "react-router";

/**
 * Actions dropdown menu for video editor
 * Provides actions like Write Article, Copy Transcript, Export, DaVinci Resolve integration, etc.
 */
export const ActionsDropdown = (props: {
  /** Whether silence detection has completed for all clips */
  allClipsHaveSilenceDetected: boolean;
  /** Whether transcription has completed for all clips */
  allClipsHaveText: boolean;
  /** Callback to start export via upload manager */
  onExport: () => void;
  /** Fetcher for exporting to DaVinci Resolve */
  exportToDavinciResolveFetcher: FetcherWithComponents<unknown>;
  /** Video ID for navigation and actions */
  videoId: string;
  /** Lesson ID if video is part of a lesson (enables "Add New Video" option) */
  lessonId?: string;
  /** Whether the export modal is open */
  isExportModalOpen: boolean;
  /** Callback to set export modal open state */
  setIsExportModalOpen: (open: boolean) => void;
  /** Whether transcript has been copied (shows checkmark) */
  isCopied: boolean;
  /** Callback to copy transcript to clipboard */
  copyTranscriptToClipboard: () => void;
  /** YouTube chapters generated from clip sections */
  youtubeChapters: { timestamp: string; name: string }[];
  /** Whether YouTube chapters have been copied (shows checkmark) */
  isChaptersCopied: boolean;
  /** Callback to copy YouTube chapters to clipboard */
  copyYoutubeChaptersToClipboard: () => void;
  /** Callback to open "Add New Video" modal */
  onAddVideoClick: () => void;
  /** Callback to open "Add Note from Clipboard" modal */
  onAddNoteFromClipboard: () => void;
  /** Callback to open "Rename Video" modal */
  onRenameVideoClick: () => void;
  /** Callback to reveal video in file system */
  onRevealInFileSystem: () => void;
  /** Whether log path has been copied (shows checkmark) */
  isLogPathCopied: boolean;
  /** Callback to copy log path to clipboard */
  copyLogPathToClipboard: () => void;
}) => {
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <span>
            <DropdownMenuTrigger asChild>
              <Button
                variant="secondary"
                disabled={!props.allClipsHaveSilenceDetected}
              >
                {props.exportToDavinciResolveFetcher.state === "submitting" ? (
                  <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                ) : null}
                Actions
                <ChevronDown className="w-4 h-4 ml-1" />
              </Button>
            </DropdownMenuTrigger>
          </span>
        </TooltipTrigger>
        {!props.allClipsHaveSilenceDetected && (
          <TooltipContent>
            <p>Waiting for silence detection to complete</p>
          </TooltipContent>
        )}
      </Tooltip>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuItem onSelect={props.onRenameVideoClick}>
          <PencilLineIcon className="w-4 h-4 mr-2" />
          <div className="flex flex-col">
            <span className="font-medium">Rename Video</span>
            <span className="text-xs text-muted-foreground">
              Change the video name
            </span>
          </div>
        </DropdownMenuItem>

        <DropdownMenuItem onSelect={props.onRevealInFileSystem}>
          <FolderOpen className="w-4 h-4 mr-2" />
          <div className="flex flex-col">
            <span className="font-medium">Reveal in File System</span>
            <span className="text-xs text-muted-foreground">
              Open in Windows Explorer
            </span>
          </div>
        </DropdownMenuItem>

        <DropdownMenuItem onSelect={props.copyLogPathToClipboard}>
          {props.isLogPathCopied ? (
            <CheckIcon className="w-4 h-4 mr-2" />
          ) : (
            <ScrollTextIcon className="w-4 h-4 mr-2" />
          )}
          <div className="flex flex-col">
            <span className="font-medium">Copy Log Path</span>
            <span className="text-xs text-muted-foreground">
              Copy operation log file path
            </span>
          </div>
        </DropdownMenuItem>

        <Tooltip>
          <TooltipTrigger asChild>
            <div>
              <DropdownMenuItem
                disabled={!props.allClipsHaveText}
                onSelect={props.copyTranscriptToClipboard}
              >
                {props.isCopied ? (
                  <CheckIcon className="w-4 h-4 mr-2" />
                ) : (
                  <CopyIcon className="w-4 h-4 mr-2" />
                )}
                <div className="flex flex-col">
                  <span className="font-medium">Copy Transcript</span>
                  <span className="text-xs text-muted-foreground">
                    Copy all transcript to clipboard
                  </span>
                </div>
              </DropdownMenuItem>
            </div>
          </TooltipTrigger>
          {!props.allClipsHaveText && (
            <TooltipContent side="left">
              <p>Waiting for transcription to complete</p>
            </TooltipContent>
          )}
        </Tooltip>

        {props.youtubeChapters.length > 0 && (
          <DropdownMenuItem onSelect={props.copyYoutubeChaptersToClipboard}>
            {props.isChaptersCopied ? (
              <CheckIcon className="w-4 h-4 mr-2" />
            ) : (
              <CopyIcon className="w-4 h-4 mr-2" />
            )}
            <div className="flex flex-col">
              <span className="font-medium">Copy YouTube Chapters</span>
              <span className="text-xs text-muted-foreground">
                Copy chapter timestamps to clipboard
              </span>
            </div>
          </DropdownMenuItem>
        )}

        <ExportModal
          isOpen={props.isExportModalOpen}
          setIsOpen={props.setIsExportModalOpen}
          onExport={props.onExport}
          youtubeChapters={props.youtubeChapters}
          isChaptersCopied={props.isChaptersCopied}
          copyYoutubeChaptersToClipboard={props.copyYoutubeChaptersToClipboard}
        />

        <DropdownMenuItem
          onSelect={() => {
            props.exportToDavinciResolveFetcher.submit(null, {
              method: "post",
              action: `/videos/${props.videoId}/export-to-davinci-resolve`,
            });
          }}
        >
          <FilmIcon className="w-4 h-4 mr-2" />
          <div className="flex flex-col">
            <span className="font-medium">DaVinci Resolve</span>
            <span className="text-xs text-muted-foreground">
              Create a new timeline with clips
            </span>
          </div>
        </DropdownMenuItem>

        {props.lessonId && (
          <DropdownMenuItem onSelect={props.onAddVideoClick}>
            <Plus className="w-4 h-4 mr-2" />
            <div className="flex flex-col">
              <span className="font-medium">Add New Video</span>
              <span className="text-xs text-muted-foreground">
                Add another video to this lesson
              </span>
            </div>
          </DropdownMenuItem>
        )}

        <DropdownMenuItem onSelect={props.onAddNoteFromClipboard}>
          <ClipboardIcon className="w-4 h-4 mr-2" />
          <div className="flex flex-col">
            <span className="font-medium">Add Note from Clipboard</span>
            <span className="text-xs text-muted-foreground">
              Paste notes or images for article writing
            </span>
          </div>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
