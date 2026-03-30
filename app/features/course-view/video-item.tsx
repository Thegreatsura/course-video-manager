import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { cn } from "@/lib/utils";
import { formatSecondsToTimeCode } from "@/services/utils";
import { courseViewReducer } from "@/features/course-view/course-view-reducer";
import {
  ArrowRightLeft,
  Combine,
  Download,
  FileVideo,
  FileX,
  FolderOpen,
  PencilIcon,
  Play,
  Trash2,
} from "lucide-react";
import { use } from "react";
import { Link, useNavigate, useFetcher } from "react-router";
import type { LoaderData, Section, Lesson, Video } from "./course-view-types";

export function VideoItem({
  video,
  section,
  lesson,
  data,
  navigate,
  dispatch,
  startExportUpload,
  revealVideoFetcher,
  deleteVideoFileFetcher,
  deleteVideoFetcher,
}: {
  video: Video;
  section: Section;
  lesson: Lesson;
  data: LoaderData;
  navigate: ReturnType<typeof useNavigate>;
  dispatch: (action: courseViewReducer.Action) => void;
  startExportUpload: (videoId: string, path: string) => void;
  revealVideoFetcher: ReturnType<typeof useFetcher>;
  deleteVideoFileFetcher: ReturnType<typeof useFetcher>;
  deleteVideoFetcher: ReturnType<typeof useFetcher>;
}) {
  const hasExportedVideoMap = use(data.hasExportedVideoMap);
  const totalDuration = video.totalDuration;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <Link
          to={`/videos/${video.id}/edit`}
          className="flex items-center justify-between text-xs py-1 px-2 rounded hover:bg-muted/50 transition-colors cursor-context-menu w-full text-left"
        >
          <div className="flex items-center gap-1.5 min-w-0">
            <FileVideo
              className={cn(
                "w-3 h-3 shrink-0",
                hasExportedVideoMap[video.id]
                  ? "text-muted-foreground"
                  : "text-red-500"
              )}
            />
            <span className="truncate text-muted-foreground">{video.path}</span>
          </div>
          <span className="text-muted-foreground font-mono ml-2 shrink-0">
            {formatSecondsToTimeCode(totalDuration)}
          </span>
        </Link>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem
          onSelect={() => {
            dispatch({
              type: "open-video-player",
              videoId: video.id,
              videoPath: `${section.path}/${lesson.path}/${video.path}`,
            });
          }}
        >
          <Play className="w-4 h-4" />
          Play Video
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={() => {
            startExportUpload(
              video.id,
              `${section.path}/${lesson.path}/${video.path}`
            );
          }}
        >
          <Download className="w-4 h-4" />
          Export
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={() => {
            navigate(`/videos/concatenate?initial=${video.id}`);
          }}
        >
          <Combine className="w-4 h-4" />
          Create Concatenated Video
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={() => {
            revealVideoFetcher.submit(
              {},
              {
                method: "post",
                action: `/api/videos/${video.id}/reveal`,
              }
            );
          }}
        >
          <FolderOpen className="w-4 h-4" />
          Reveal in File System
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={() => {
            dispatch({
              type: "open-rename-video",
              videoId: video.id,
              videoPath: video.path,
            });
          }}
        >
          <PencilIcon className="w-4 h-4" />
          Rename
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={() => {
            dispatch({
              type: "open-move-video",
              videoId: video.id,
              videoPath: video.path,
              currentLessonId: lesson.id,
            });
          }}
        >
          <ArrowRightLeft className="w-4 h-4" />
          Move to Lesson
        </ContextMenuItem>
        {hasExportedVideoMap[video.id] && (
          <ContextMenuItem
            variant="destructive"
            onSelect={() => {
              deleteVideoFileFetcher.submit(
                {},
                {
                  method: "post",
                  action: `/api/videos/${video.id}/purge-export`,
                }
              );
            }}
          >
            <FileX className="w-4 h-4" />
            Purge Export
          </ContextMenuItem>
        )}
        <ContextMenuItem
          variant="destructive"
          onSelect={() => {
            deleteVideoFetcher.submit(
              { videoId: video.id },
              {
                method: "post",
                action: "/api/videos/delete",
              }
            );
          }}
        >
          <Trash2 className="w-4 h-4" />
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
