import { DuplicateCourseModal } from "@/components/duplicate-course-modal";
import { PurgeExportsModal } from "@/components/purge-exports-modal";
import { CopyTranscriptModal } from "@/components/copy-transcript-modal";
import { MoveVideoModal } from "@/components/move-video-modal";
import { RenameCourseModal } from "@/components/rename-course-modal";
import { RenameVideoModal } from "@/components/rename-video-modal";
import { RewriteCoursePathModal } from "@/components/rewrite-course-path-modal";
import { VersionSelectorModal } from "@/components/version-selector-modal";
import { courseViewReducer } from "@/features/course-view/course-view-reducer";

import {
  Code,
  FileVideo,
  Ghost,
  GitBranch,
  ListChecks,
  MessageCircle,
  Play,
  Plus,
  Search,
  VideoIcon,
  X,
} from "lucide-react";
import { Suspense, use } from "react";
import { Link, useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { LoaderData } from "./course-view-types";

export function StatsBar({
  selectedCourse,
  gitStatus,
}: {
  selectedCourse: LoaderData["selectedCourse"];
  gitStatus: LoaderData["gitStatus"];
}) {
  const totalLessonsWithVideos =
    selectedCourse?.sections.reduce((acc, section) => {
      return (
        acc +
        section.lessons.filter(
          (lesson) => lesson.fsStatus !== "ghost" && lesson.videos.length > 0
        ).length
      );
    }, 0) ?? 0;

  const totalLessons =
    selectedCourse?.sections.reduce((acc, section) => {
      return (
        acc +
        section.lessons.filter((lesson) => lesson.fsStatus !== "ghost").length
      );
    }, 0) ?? 0;

  const totalVideos =
    selectedCourse?.sections.reduce((acc, section) => {
      return (
        acc +
        section.lessons.reduce((lessonAcc, lesson) => {
          return lessonAcc + lesson.videos.length;
        }, 0)
      );
    }, 0) ?? 0;

  const totalDurationSeconds =
    selectedCourse?.sections.reduce((acc, section) => {
      return (
        acc +
        section.lessons.reduce((lessonAcc, lesson) => {
          return (
            lessonAcc +
            lesson.videos.reduce(
              (videoAcc, video) => videoAcc + video.totalDuration,
              0
            )
          );
        }, 0)
      );
    }, 0) ?? 0;

  const totalDurationFormatted = (() => {
    const hours = Math.floor(totalDurationSeconds / 3600);
    const minutes = Math.floor((totalDurationSeconds % 3600) / 60);
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  })();

  const percentageComplete =
    totalLessons > 0
      ? Math.round((totalLessonsWithVideos / totalLessons) * 100)
      : 0;

  return (
    <div className="flex items-center gap-2">
      <span className="inline-flex items-center rounded-md bg-secondary px-2 py-1 text-xs font-medium text-secondary-foreground">
        {totalLessonsWithVideos} / {totalLessons} lessons ({percentageComplete}
        %)
      </span>
      <span className="inline-flex items-center rounded-md bg-secondary px-2 py-1 text-xs font-medium text-secondary-foreground">
        {totalVideos} videos
      </span>
      {totalDurationSeconds > 0 && (
        <span className="inline-flex items-center rounded-md bg-secondary px-2 py-1 text-xs font-medium text-secondary-foreground">
          {totalDurationFormatted}
        </span>
      )}
      <Suspense>
        <GitStatusBadge gitStatus={gitStatus} />
      </Suspense>
    </div>
  );
}

function GitStatusBadge({ gitStatus }: { gitStatus: LoaderData["gitStatus"] }) {
  const resolved = use(gitStatus);
  if (!resolved || resolved.total === 0) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-yellow-500/20 px-2 py-1 text-xs font-medium text-yellow-600">
      <GitBranch className="w-3 h-3" />
      {resolved.total} change{resolved.total !== 1 ? "s" : ""}
    </span>
  );
}

export function FilterBar({
  priorityFilter,
  iconFilter,
  fsStatusFilter,
  fsStatusCounts,
  searchQuery,
  dispatch,
  isRealCourse,
}: {
  priorityFilter: number[];
  iconFilter: string[];
  fsStatusFilter: string | null;
  fsStatusCounts: { ghost: number; real: number; todo: number };
  searchQuery: string;
  dispatch: (action: courseViewReducer.Action) => void;
  isRealCourse: boolean;
}) {
  const hasActiveFilters =
    priorityFilter.length > 0 ||
    iconFilter.length > 0 ||
    fsStatusFilter !== null ||
    searchQuery.length > 0;

  return (
    <div className="space-y-3">
      {/* Search input */}
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
        <Input
          placeholder="Search"
          value={searchQuery}
          onChange={(e) =>
            dispatch({ type: "set-search-query", query: e.target.value })
          }
          className="pl-8 h-8 text-sm max-w-sm"
        />
        {searchQuery && (
          <button
            onClick={() => dispatch({ type: "set-search-query", query: "" })}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Filter buttons */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-muted-foreground">Filters:</span>
        {([1, 2, 3] as const).map((priority) => {
          const isSelected = priorityFilter.includes(priority);
          const showAsActive = priorityFilter.length === 0 || isSelected;
          return (
            <button
              key={priority}
              className={`text-xs px-2 py-0.5 rounded-sm font-medium transition-colors ${
                showAsActive
                  ? priority === 1
                    ? "bg-red-500/20 text-red-600"
                    : priority === 2
                      ? "bg-yellow-500/20 text-yellow-600"
                      : "bg-sky-500/20 text-sky-500"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              } ${isSelected ? "ring-1 ring-current" : ""}`}
              onClick={() =>
                dispatch({ type: "toggle-priority-filter", priority })
              }
            >
              P{priority}
            </button>
          );
        })}

        <span className="text-muted-foreground mx-0.5">|</span>
        {(["code", "discussion", "watch"] as const).map((icon) => {
          const isSelected = iconFilter.includes(icon);
          const showAsActive = iconFilter.length === 0 || isSelected;
          return (
            <button
              key={icon}
              className={`flex items-center justify-center w-6 h-6 rounded-full transition-colors ${
                icon === "code"
                  ? showAsActive
                    ? "bg-yellow-500/20 text-yellow-600"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                  : icon === "discussion"
                    ? showAsActive
                      ? "bg-green-500/20 text-green-600"
                      : "bg-muted text-muted-foreground hover:bg-muted/80"
                    : showAsActive
                      ? "bg-purple-500/20 text-purple-600"
                      : "bg-muted text-muted-foreground hover:bg-muted/80"
              } ${isSelected ? "ring-1 ring-current" : ""}`}
              onClick={() => dispatch({ type: "toggle-icon-filter", icon })}
              title={
                icon === "code"
                  ? "Interactive"
                  : icon === "discussion"
                    ? "Discussion"
                    : "Watch"
              }
            >
              {icon === "code" ? (
                <Code className="w-3 h-3" />
              ) : icon === "discussion" ? (
                <MessageCircle className="w-3 h-3" />
              ) : (
                <Play className="w-3 h-3" />
              )}
            </button>
          );
        })}

        {isRealCourse && (
          <>
            <span className="text-muted-foreground mx-0.5">|</span>
            {(["ghost", "real", "todo"] as const).map((status) => {
              const isSelected = fsStatusFilter === status;
              const showAsActive = fsStatusFilter === null || isSelected;
              return (
                <button
                  key={status}
                  className={`text-xs px-2 py-0.5 rounded-sm font-medium transition-colors flex items-center gap-1 ${
                    showAsActive
                      ? "bg-muted text-muted-foreground"
                      : "bg-muted text-muted-foreground hover:bg-muted/80"
                  } ${isSelected ? "ring-1 ring-current" : ""}`}
                  onClick={() =>
                    dispatch({ type: "toggle-fs-status-filter", status })
                  }
                  title={
                    status === "ghost"
                      ? "Ghost"
                      : status === "real"
                        ? "Real"
                        : "Todo"
                  }
                >
                  {status === "ghost" ? (
                    <Ghost className="w-3 h-3" />
                  ) : status === "real" ? (
                    <FileVideo className="w-3 h-3" />
                  ) : (
                    <ListChecks className="w-3 h-3" />
                  )}
                  {status === "ghost"
                    ? "Ghost"
                    : status === "real"
                      ? "Real"
                      : "Todo"}
                  <span className="opacity-60">{fsStatusCounts[status]}</span>
                </button>
              );
            })}
          </>
        )}

        {hasActiveFilters && (
          <>
            <span className="text-muted-foreground mx-0.5">|</span>
            <button
              className="text-xs px-2 py-0.5 rounded-sm text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => {
                if (priorityFilter.length > 0) {
                  for (const p of priorityFilter) {
                    dispatch({ type: "toggle-priority-filter", priority: p });
                  }
                }
                if (iconFilter.length > 0) {
                  for (const i of iconFilter) {
                    dispatch({ type: "toggle-icon-filter", icon: i });
                  }
                }
                if (fsStatusFilter !== null) {
                  dispatch({
                    type: "toggle-fs-status-filter",
                    status: fsStatusFilter,
                  });
                }
                if (searchQuery) {
                  dispatch({ type: "set-search-query", query: "" });
                }
              }}
            >
              Clear all
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export function ReadOnlyBanner() {
  return (
    <div className="mb-4 rounded-md border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm text-amber-600 dark:text-amber-400">
      Viewing published version — read-only
    </div>
  );
}

export function NoCourseView({
  courses,
  standaloneVideos,
  dispatch,
}: {
  courses: LoaderData["courses"];
  standaloneVideos: LoaderData["standaloneVideos"];
  dispatch: (action: courseViewReducer.Action) => void;
}) {
  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold mb-2">Course Video Manager</h1>
        <p className="text-sm text-muted-foreground">Select a course</p>
      </div>

      {standaloneVideos.length > 0 && (
        <div className="mb-8">
          <h2 className="text-lg font-semibold mb-4">
            Recent Unattached Videos
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {standaloneVideos.slice(0, 3).map((video) => {
              return (
                <Link
                  key={video.id}
                  to={`/videos/${video.id}/edit`}
                  className="block border rounded-lg p-4 hover:border-primary/50 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <VideoIcon className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm font-medium truncate">
                      {video.path}
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {courses.map((course) => (
          <Link
            key={course.id}
            to={`?courseId=${course.id}`}
            className="block border rounded-lg p-6 hover:border-primary/50 transition-colors cursor-pointer"
          >
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-lg font-semibold">{course.name}</h3>
            </div>
            <p className="text-sm text-muted-foreground">
              {course.filePath ?? "Ghost course"}
            </p>
          </Link>
        ))}
      </div>

      {courses.length === 0 && (
        <div className="text-center py-12">
          <div className="mb-4">
            <VideoIcon className="w-16 h-16 mx-auto text-muted-foreground/50" />
          </div>
          <h3 className="text-xl font-semibold mb-2">No courses found</h3>
          <p className="text-muted-foreground mb-6">
            Get started by adding your first course
          </p>
          <Button
            onClick={() =>
              dispatch({ type: "set-add-course-modal-open", open: true })
            }
            className="mx-auto"
          >
            <Plus className="w-4 h-4 mr-2" />
            Add Course
          </Button>
        </div>
      )}
    </div>
  );
}

export function RouteModals({
  currentCourse,
  data,
  selectedCourseId,
  viewState,
  dispatch,
  navigate,
}: {
  currentCourse: NonNullable<LoaderData["selectedCourse"]> | undefined;
  data: LoaderData;
  selectedCourseId: string | null;
  viewState: {
    isRenameCourseModalOpen: boolean;
    isVersionSelectorModalOpen: boolean;
    isPurgeExportsModalOpen: boolean;
    isRewriteCoursePathModalOpen: boolean;
    isCopyTranscriptModalOpen: boolean;
    isDuplicateCourseModalOpen: boolean;
    copySectionTranscriptState: {
      sectionPath: string;
      sectionDescription: string | undefined;
      lessons: import("./course-view-types").Lesson[];
    } | null;
    moveVideoState: {
      videoId: string;
      videoPath: string;
      currentLessonId: string;
    } | null;
    renameVideoState: {
      videoId: string;
      videoPath: string;
    } | null;
    priorityFilter: number[];
    iconFilter: string[];
    fsStatusFilter: string | null;
  };
  dispatch: (action: courseViewReducer.Action) => void;
  navigate: ReturnType<typeof useNavigate>;
}) {
  return (
    <>
      {currentCourse && (
        <RenameCourseModal
          courseId={currentCourse.id}
          currentName={currentCourse.name}
          open={viewState.isRenameCourseModalOpen}
          onOpenChange={(open) =>
            dispatch({ type: "set-rename-course-modal-open", open })
          }
        />
      )}

      {currentCourse && (
        <DuplicateCourseModal
          courseId={currentCourse.id}
          currentName={currentCourse.name}
          currentFilePath={currentCourse.filePath}
          open={viewState.isDuplicateCourseModalOpen}
          onOpenChange={(open) =>
            dispatch({ type: "set-duplicate-course-modal-open", open })
          }
        />
      )}

      {selectedCourseId && data.versions.length > 0 && (
        <VersionSelectorModal
          versions={data.versions}
          selectedVersionId={data.selectedVersion?.id}
          isOpen={viewState.isVersionSelectorModalOpen}
          onOpenChange={(open) =>
            dispatch({ type: "set-version-selector-modal-open", open })
          }
          onSelectVersion={(versionId) => {
            navigate(`?courseId=${selectedCourseId}&versionId=${versionId}`, {
              preventScrollReset: true,
            });
          }}
        />
      )}

      {currentCourse && data.selectedVersion && (
        <PurgeExportsModal
          repoId={currentCourse.id}
          versionId={data.selectedVersion.id}
          versionName={data.selectedVersion.name}
          open={viewState.isPurgeExportsModalOpen}
          onOpenChange={(open) =>
            dispatch({ type: "set-purge-exports-modal-open", open })
          }
        />
      )}

      {currentCourse && currentCourse.filePath && (
        <RewriteCoursePathModal
          courseId={currentCourse.id}
          currentPath={currentCourse.filePath}
          open={viewState.isRewriteCoursePathModalOpen}
          onOpenChange={(open) =>
            dispatch({ type: "set-rewrite-course-path-modal-open", open })
          }
        />
      )}

      <Suspense>
        {currentCourse && (
          <CopyTranscriptModal
            mode="course"
            courseName={currentCourse.name}
            sections={currentCourse.sections}
            videoTranscripts={data.videoTranscripts}
            open={viewState.isCopyTranscriptModalOpen}
            onOpenChange={(open) =>
              dispatch({ type: "set-copy-transcript-modal-open", open })
            }
            priorityFilter={viewState.priorityFilter}
            iconFilter={viewState.iconFilter}
            fsStatusFilter={viewState.fsStatusFilter}
            onTogglePriority={(priority) =>
              dispatch({ type: "toggle-priority-filter", priority })
            }
            onToggleIcon={(icon) =>
              dispatch({ type: "toggle-icon-filter", icon })
            }
            onToggleFsStatus={(status) =>
              dispatch({ type: "toggle-fs-status-filter", status })
            }
          />
        )}

        {viewState.copySectionTranscriptState && (
          <CopyTranscriptModal
            mode="section"
            sectionPath={viewState.copySectionTranscriptState.sectionPath}
            sectionDescription={
              viewState.copySectionTranscriptState.sectionDescription
            }
            lessons={viewState.copySectionTranscriptState.lessons}
            videoTranscripts={data.videoTranscripts}
            open={true}
            onOpenChange={(open) => {
              if (!open) dispatch({ type: "close-copy-section-transcript" });
            }}
            priorityFilter={viewState.priorityFilter}
            iconFilter={viewState.iconFilter}
            fsStatusFilter={viewState.fsStatusFilter}
            onTogglePriority={(priority) =>
              dispatch({ type: "toggle-priority-filter", priority })
            }
            onToggleIcon={(icon) =>
              dispatch({ type: "toggle-icon-filter", icon })
            }
            onToggleFsStatus={(status) =>
              dispatch({ type: "toggle-fs-status-filter", status })
            }
          />
        )}
      </Suspense>

      {viewState.moveVideoState && currentCourse && (
        <MoveVideoModal
          videoId={viewState.moveVideoState.videoId}
          videoPath={viewState.moveVideoState.videoPath}
          currentLessonId={viewState.moveVideoState.currentLessonId}
          sections={currentCourse.sections}
          open={true}
          onOpenChange={(open) => {
            if (!open) dispatch({ type: "close-move-video" });
          }}
        />
      )}

      {viewState.renameVideoState && (
        <RenameVideoModal
          videoId={viewState.renameVideoState.videoId}
          currentName={viewState.renameVideoState.videoPath}
          open={true}
          onOpenChange={(open) => {
            if (!open) dispatch({ type: "close-rename-video" });
          }}
          onRename={(newName) => {
            dispatch({
              type: "rename-video-optimistic",
              videoId: viewState.renameVideoState!.videoId,
              newName,
            });
          }}
        />
      )}
    </>
  );
}
