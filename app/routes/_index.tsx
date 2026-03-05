"use client";

import { AppSidebar } from "@/components/app-sidebar";
import { AddVideoModal } from "@/components/add-video-modal";
import { ClearVideoFilesModal } from "@/components/clear-video-files-modal";
import { CreateVersionModal } from "@/components/create-version-modal";
import { DeleteVersionModal } from "@/components/delete-version-modal";
import { EditLessonModal } from "@/components/edit-lesson-modal";
import { MoveVideoModal } from "@/components/move-video-modal";
import { RenameVideoModal } from "@/components/rename-video-modal";
import { RenameRepoModal } from "@/components/rename-repo-modal";
import { RewriteRepoPathModal } from "@/components/rewrite-repo-path-modal";
import { RenameVersionModal } from "@/components/rename-version-modal";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { VersionSelectorModal } from "@/components/version-selector-modal";
import { VideoModal } from "@/components/video-player";
import { useFocusRevalidate } from "@/hooks/use-focus-revalidate";
import { getVideoPath } from "@/lib/get-video";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { cn, isLeftClick } from "@/lib/utils";
import { DBFunctionsService } from "@/services/db-service.server";
import { FeatureFlagService } from "@/services/feature-flag-service";
import { runtimeLive } from "@/services/layer.server";
import { formatSecondsToTimeCode } from "@/services/utils";
import { FileSystem } from "@effect/platform";
import { Console, Effect } from "effect";
import {
  Archive,
  ArrowRightLeft,
  BookOpen,
  ChevronDown,
  Copy,
  Download,
  FileVideo,
  Film,
  FileText,
  FileX,
  FolderOpen,
  FolderPen,
  LayoutGrid,
  Loader2,
  PencilIcon,
  Play,
  Plus,
  Send,
  Trash2,
  VideoIcon,
} from "lucide-react";
import React, { useContext, useState } from "react";
import {
  data,
  Link,
  useFetcher,
  useNavigate,
  useSearchParams,
} from "react-router";
import type { Route } from "./+types/_index";
import { toast } from "sonner";
import { UploadContext } from "@/features/upload-manager/upload-context";

export const meta: Route.MetaFunction = ({ data }) => {
  const selectedRepo = data?.selectedRepo;

  if (selectedRepo) {
    return [
      {
        title: `CVM - ${selectedRepo.name}`,
      },
    ];
  }

  return [
    {
      title: "CVM",
    },
  ];
};

export const loader = async (args: Route.LoaderArgs) => {
  const url = new URL(args.request.url);
  const selectedRepoId = url.searchParams.get("repoId");
  const selectedVersionId = url.searchParams.get("versionId");

  return Effect.gen(function* () {
    const db = yield* DBFunctionsService;
    const fs = yield* FileSystem.FileSystem;
    const featureFlags = yield* FeatureFlagService;

    // First get repos and versions for the selected repo
    const repos = yield* db.getRepos();
    const standaloneVideos = yield* db.getStandaloneVideos();
    const plans = yield* db.getPlans();

    let versions: Awaited<
      ReturnType<typeof db.getRepoVersions>
    > extends Effect.Effect<infer R, any, any>
      ? R
      : never = [];
    let selectedVersion: Awaited<
      ReturnType<typeof db.getLatestRepoVersion>
    > extends Effect.Effect<infer R, any, any>
      ? R
      : never = undefined;

    if (selectedRepoId) {
      versions = yield* db.getRepoVersions(selectedRepoId);

      // If versionId provided, use it; otherwise use latest
      if (selectedVersionId) {
        selectedVersion = yield* db
          .getRepoVersionById(selectedVersionId)
          .pipe(
            Effect.catchTag("NotFoundError", () => Effect.succeed(undefined))
          );
      } else {
        selectedVersion = yield* db.getLatestRepoVersion(selectedRepoId);
      }
    }

    const selectedRepo = yield* !selectedRepoId
      ? Effect.succeed(undefined)
      : db.getRepoWithSectionsById(selectedRepoId).pipe(
          Effect.andThen((repo) => {
            if (!repo) {
              return undefined;
            }

            // Get sections from selected version only (or latest if none selected)
            const versionData =
              repo.versions.find((v) => v.id === selectedVersion?.id) ??
              repo.versions[0];
            const allSections = versionData?.sections ?? [];

            return {
              ...repo,
              sections: allSections
                .filter((section) => {
                  return !section.path.endsWith("ARCHIVE");
                })
                .filter((section) => section.lessons.length > 0),
            };
          })
        );

    const hasExportedVideoMap: Record<string, boolean> = {};

    const videos = selectedRepo?.sections.flatMap((section) =>
      section.lessons.flatMap((lesson) => lesson.videos)
    );

    yield* Effect.forEach(videos ?? [], (video) => {
      return Effect.gen(function* () {
        const hasExportedVideo = yield* fs.exists(getVideoPath(video.id));

        hasExportedVideoMap[video.id] = hasExportedVideo;
      });
    });

    // Check for explainer folder in each lesson
    const hasExplainerFolderMap: Record<string, boolean> = {};

    const lessons =
      selectedRepo?.sections.flatMap((section) =>
        section.lessons.map((lesson) => ({
          id: lesson.id,
          fullPath: `${selectedRepo.filePath}/${section.path}/${lesson.path}`,
        }))
      ) ?? [];

    yield* Effect.forEach(lessons, (lesson) => {
      return Effect.gen(function* () {
        const explainerPath = `${lesson.fullPath}/explainer`;
        const hasExplainerFolder = yield* fs.exists(explainerPath);

        hasExplainerFolderMap[lesson.id] = hasExplainerFolder;
      });
    });

    // Determine if selected version is the latest
    const latestVersion = versions[0];
    const isLatestVersion = !!(
      selectedVersion &&
      latestVersion &&
      selectedVersion.id === latestVersion.id
    );

    return {
      repos,
      standaloneVideos,
      selectedRepo,
      versions,
      selectedVersion,
      isLatestVersion,
      hasExportedVideoMap,
      hasExplainerFolderMap,
      plans,
      showMediaFilesList: featureFlags.isEnabled("ENABLE_MEDIA_FILES_LIST"),
    };
  }).pipe(
    Effect.tapErrorCause((e) => Console.dir(e, { depth: null })),
    Effect.catchTag("NotFoundError", () => {
      return Effect.die(data("Not Found", { status: 404 }));
    }),
    Effect.catchAll(() => {
      return Effect.die(data("Internal server error", { status: 500 }));
    }),
    runtimeLive.runPromise
  );
};

export default function Component(props: Route.ComponentProps) {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const selectedRepoId = searchParams.get("repoId");
  const [isAddRepoModalOpen, setIsAddRepoModalOpen] = useState(false);
  const [addVideoToLessonId, setAddVideoToLessonId] = useState<string | null>(
    null
  );
  const [editLessonId, setEditLessonId] = useState<string | null>(null);
  const [videoPlayerState, setVideoPlayerState] = useState<{
    isOpen: boolean;
    videoId: string;
    videoPath: string;
  }>({
    isOpen: false,
    videoId: "",
    videoPath: "",
  });
  const [isCreateVersionModalOpen, setIsCreateVersionModalOpen] =
    useState(false);
  const [isVersionSelectorModalOpen, setIsVersionSelectorModalOpen] =
    useState(false);
  const [isRenameVersionModalOpen, setIsRenameVersionModalOpen] =
    useState(false);
  const [isRenameRepoModalOpen, setIsRenameRepoModalOpen] = useState(false);
  const [isDeleteVersionModalOpen, setIsDeleteVersionModalOpen] =
    useState(false);
  const [isClearVideoFilesModalOpen, setIsClearVideoFilesModalOpen] =
    useState(false);
  const [isRewriteRepoPathModalOpen, setIsRewriteRepoPathModalOpen] =
    useState(false);
  const [isAddStandaloneVideoModalOpen, setIsAddStandaloneVideoModalOpen] =
    useState(false);
  const [moveVideoState, setMoveVideoState] = useState<{
    videoId: string;
    videoPath: string;
    currentLessonId: string;
  } | null>(null);
  const [renameVideoState, setRenameVideoState] = useState<{
    videoId: string;
    videoPath: string;
  } | null>(null);

  const publishRepoFetcher = useFetcher();
  const { startExportUpload, startBatchExportUpload } =
    useContext(UploadContext);

  useFocusRevalidate({ enabled: !!selectedRepoId, intervalMs: 5000 });

  const deleteVideoFetcher = useFetcher();
  const deleteVideoFileFetcher = useFetcher();
  const deleteLessonFetcher = useFetcher();
  const revealVideoFetcher = useFetcher();
  const archiveRepoFetcher = useFetcher();

  const data = props.loaderData;

  const repos = data.repos;

  const currentRepo = data.selectedRepo;

  const totalLessonsWithVideos =
    data.selectedRepo?.sections.reduce((acc, section) => {
      return (
        acc +
        section.lessons.filter((lesson) => lesson.videos.length > 0).length
      );
    }, 0) ?? 0;

  const totalLessons =
    data.selectedRepo?.sections.reduce((acc, section) => {
      return acc + section.lessons.length;
    }, 0) ?? 0;

  const totalVideos =
    data.selectedRepo?.sections.reduce((acc, section) => {
      return (
        acc +
        section.lessons.reduce((lessonAcc, lesson) => {
          return lessonAcc + lesson.videos.length;
        }, 0)
      );
    }, 0) ?? 0;

  const percentageComplete =
    totalLessons > 0
      ? Math.round((totalLessonsWithVideos / totalLessons) * 100)
      : 0;

  const handleBatchExport = () => {
    if (!data.selectedVersion) return;
    startBatchExportUpload(data.selectedVersion.id);
  };

  return (
    <div className="flex h-screen bg-background text-foreground">
      <AppSidebar
        repos={repos}
        standaloneVideos={data.standaloneVideos}
        selectedRepoId={selectedRepoId}
        isAddRepoModalOpen={isAddRepoModalOpen}
        setIsAddRepoModalOpen={setIsAddRepoModalOpen}
        isAddStandaloneVideoModalOpen={isAddStandaloneVideoModalOpen}
        setIsAddStandaloneVideoModalOpen={setIsAddStandaloneVideoModalOpen}
        plans={data.plans}
      />

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-6">
          {currentRepo ? (
            <>
              <div className="flex gap-6">
                <div>
                  <h1 className="text-2xl font-bold mb-2 flex items-center gap-2">
                    {currentRepo.name}
                    {data.selectedVersion && data.versions.length > 1 && (
                      <button
                        onClick={() => setIsVersionSelectorModalOpen(true)}
                        className="text-muted-foreground hover:text-foreground transition-colors text-lg font-normal"
                      >
                        [{data.selectedVersion.name}]
                      </button>
                    )}
                  </h1>
                  <div className="flex items-center gap-2 mb-8">
                    <span className="inline-flex items-center rounded-md bg-secondary px-2 py-1 text-xs font-medium text-secondary-foreground">
                      {totalLessonsWithVideos} / {totalLessons} lessons (
                      {percentageComplete}%)
                    </span>
                    <span className="inline-flex items-center rounded-md bg-secondary px-2 py-1 text-xs font-medium text-secondary-foreground">
                      {totalVideos} videos
                    </span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        disabled={publishRepoFetcher.state === "submitting"}
                      >
                        {publishRepoFetcher.state === "submitting" ? (
                          <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                        ) : null}
                        Actions
                        <ChevronDown className="w-4 h-4 ml-1" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-64">
                      <DropdownMenuItem
                        disabled={!data.selectedVersion}
                        onSelect={() => {
                          handleBatchExport();
                        }}
                      >
                        <Download className="w-4 h-4 mr-2" />
                        <div className="flex flex-col">
                          <span className="font-medium">Export</span>
                          <span className="text-xs text-muted-foreground">
                            Export videos not yet exported
                          </span>
                        </div>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onSelect={() => {
                          publishRepoFetcher
                            .submit(
                              { repoId: currentRepo.id },
                              {
                                method: "post",
                                action: "/api/repos/publish-to-dropbox",
                              }
                            )
                            .then((data) => {
                              const result = data as
                                | {
                                    missingVideos: { videoId: string }[];
                                  }
                                | undefined;
                              const missingCount =
                                result?.missingVideos?.length ?? 0;
                              if (missingCount > 0) {
                                toast.warning(
                                  `Published to Dropbox, but ${missingCount} video${missingCount === 1 ? " was" : "s were"} not exported`
                                );
                              } else {
                                toast.success("Published to Dropbox");
                              }
                            })
                            .catch((e) => {
                              console.error("Publish failed", e);
                              toast.error("Publish failed");
                            });
                        }}
                      >
                        <Send className="w-4 h-4 mr-2" />
                        <div className="flex flex-col">
                          <span className="font-medium">Publish</span>
                          <span className="text-xs text-muted-foreground">
                            Copy all files to Dropbox
                          </span>
                        </div>
                      </DropdownMenuItem>

                      <DropdownMenuSeparator />
                      <DropdownMenuLabel>Course</DropdownMenuLabel>
                      <DropdownMenuGroup>
                        <DropdownMenuItem
                          onSelect={() => setIsRenameRepoModalOpen(true)}
                        >
                          <PencilIcon className="w-4 h-4 mr-2" />
                          <div className="flex flex-col">
                            <span className="font-medium">Rename Course</span>
                            <span className="text-xs text-muted-foreground">
                              Change course name
                            </span>
                          </div>
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() => setIsRewriteRepoPathModalOpen(true)}
                        >
                          <FolderPen className="w-4 h-4 mr-2" />
                          <div className="flex flex-col">
                            <span className="font-medium">
                              Rewrite Repo Path
                            </span>
                            <span className="text-xs text-muted-foreground">
                              Change repository file path
                            </span>
                          </div>
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() => {
                            archiveRepoFetcher.submit(
                              {
                                archived: currentRepo.archived
                                  ? "false"
                                  : "true",
                              },
                              {
                                method: "post",
                                action: `/api/repos/${currentRepo.id}/archive`,
                              }
                            );
                          }}
                        >
                          <Archive className="w-4 h-4 mr-2" />
                          <div className="flex flex-col">
                            <span className="font-medium">
                              {currentRepo.archived ? "Unarchive" : "Archive"}{" "}
                              Course
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {currentRepo.archived
                                ? "Restore course to active repos"
                                : "Hide course from main view"}
                            </span>
                          </div>
                        </DropdownMenuItem>
                      </DropdownMenuGroup>

                      {data.selectedVersion && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuLabel>Version</DropdownMenuLabel>
                          <DropdownMenuGroup>
                            {data.isLatestVersion && (
                              <DropdownMenuItem
                                onSelect={() =>
                                  setIsCreateVersionModalOpen(true)
                                }
                              >
                                <Copy className="w-4 h-4 mr-2" />
                                <div className="flex flex-col">
                                  <span className="font-medium">
                                    Create New Version
                                  </span>
                                  <span className="text-xs text-muted-foreground">
                                    Copy structure from current version
                                  </span>
                                </div>
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem
                              onSelect={() => setIsRenameVersionModalOpen(true)}
                            >
                              <PencilIcon className="w-4 h-4 mr-2" />
                              <div className="flex flex-col">
                                <span className="font-medium">
                                  Rename Version
                                </span>
                                <span className="text-xs text-muted-foreground">
                                  Change version name
                                </span>
                              </div>
                            </DropdownMenuItem>
                            {data.showMediaFilesList && (
                              <DropdownMenuItem asChild>
                                <Link
                                  to={`/repos/${currentRepo.id}/versions/${data.selectedVersion.id}/media-files`}
                                >
                                  <Film className="w-4 h-4 mr-2" />
                                  <div className="flex flex-col">
                                    <span className="font-medium">
                                      View Media Files
                                    </span>
                                    <span className="text-xs text-muted-foreground">
                                      List source footage for clips
                                    </span>
                                  </div>
                                </Link>
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem asChild>
                              <Link
                                to={`/tabbed?repoId=${currentRepo.id}${data.selectedVersion ? `&versionId=${data.selectedVersion.id}` : ""}`}
                              >
                                <LayoutGrid className="w-4 h-4 mr-2" />
                                <div className="flex flex-col">
                                  <span className="font-medium">
                                    Tabbed View
                                  </span>
                                  <span className="text-xs text-muted-foreground">
                                    View sections as tabs
                                  </span>
                                </div>
                              </Link>
                            </DropdownMenuItem>
                            {data.versions.length > 1 && (
                              <DropdownMenuItem asChild>
                                <Link to={`/repos/${currentRepo.id}/changelog`}>
                                  <FileText className="w-4 h-4 mr-2" />
                                  <div className="flex flex-col">
                                    <span className="font-medium">
                                      Preview Changelog
                                    </span>
                                    <span className="text-xs text-muted-foreground">
                                      View changes between versions
                                    </span>
                                  </div>
                                </Link>
                              </DropdownMenuItem>
                            )}
                            {data.versions.length > 1 &&
                              (() => {
                                const canDelete = data.isLatestVersion;
                                const disabledReason = !data.isLatestVersion
                                  ? "Can only delete latest version"
                                  : null;

                                const menuItem = (
                                  <DropdownMenuItem
                                    onSelect={() =>
                                      canDelete &&
                                      setIsDeleteVersionModalOpen(true)
                                    }
                                    disabled={!canDelete}
                                    className="text-destructive focus:text-destructive"
                                  >
                                    <Trash2 className="w-4 h-4 mr-2" />
                                    <div className="flex flex-col">
                                      <span className="font-medium">
                                        Delete Version
                                      </span>
                                      <span className="text-xs text-muted-foreground">
                                        Remove current version permanently
                                      </span>
                                    </div>
                                  </DropdownMenuItem>
                                );

                                if (disabledReason) {
                                  return (
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <div>{menuItem}</div>
                                      </TooltipTrigger>
                                      <TooltipContent side="left">
                                        {disabledReason}
                                      </TooltipContent>
                                    </Tooltip>
                                  );
                                }

                                return menuItem;
                              })()}
                          </DropdownMenuGroup>

                          <DropdownMenuSeparator />
                          <DropdownMenuLabel>Storage</DropdownMenuLabel>
                          <DropdownMenuGroup>
                            <DropdownMenuItem
                              onSelect={() =>
                                setIsClearVideoFilesModalOpen(true)
                              }
                              className="text-destructive focus:text-destructive"
                            >
                              <FileX className="w-4 h-4 mr-2" />
                              <div className="flex flex-col">
                                <span className="font-medium">
                                  Clear Video Files
                                </span>
                                <span className="text-xs text-muted-foreground">
                                  Delete exported videos from file system
                                </span>
                              </div>
                            </DropdownMenuItem>
                          </DropdownMenuGroup>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
                {currentRepo.sections.map((section) => {
                  const sectionDuration = section.lessons.reduce(
                    (acc, lesson) => {
                      return (
                        acc +
                        lesson.videos.reduce((videoAcc, video) => {
                          return (
                            videoAcc +
                            video.clips.reduce((clipAcc, clip) => {
                              return (
                                clipAcc +
                                (clip.sourceEndTime - clip.sourceStartTime)
                              );
                            }, 0)
                          );
                        }, 0)
                      );
                    },
                    0
                  );

                  return (
                    <div key={section.id} className="rounded-lg border bg-card">
                      <div className="px-4 py-3 border-b bg-muted/30">
                        <div className="flex items-center justify-between">
                          <h2 className="font-medium text-sm">
                            {section.path}
                          </h2>
                          <Badge variant="secondary" className="text-[10px]">
                            {section.lessons.length} lessons &middot;{" "}
                            {formatSecondsToTimeCode(sectionDuration)}
                          </Badge>
                        </div>
                      </div>
                      <div className="p-2">
                        {section.lessons.map((lesson, li) => (
                          <React.Fragment key={lesson.id}>
                            <a id={lesson.id} />
                            {li > 0 && <Separator className="my-1" />}
                            <div className="rounded-md px-2 py-2">
                              <ContextMenu>
                                <ContextMenuTrigger asChild>
                                  <div className="flex items-center gap-2 mb-1.5 cursor-context-menu hover:bg-muted/50 rounded px-1 py-0.5 transition-colors">
                                    <BookOpen className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                                    <span className="text-sm font-medium truncate">
                                      {lesson.path}
                                    </span>
                                  </div>
                                </ContextMenuTrigger>
                                <ContextMenuContent>
                                  <ContextMenuItem
                                    onSelect={() =>
                                      setAddVideoToLessonId(lesson.id)
                                    }
                                  >
                                    <Plus className="w-4 h-4" />
                                    Add Video
                                  </ContextMenuItem>
                                  <ContextMenuItem
                                    onSelect={() => setEditLessonId(lesson.id)}
                                  >
                                    <PencilIcon className="w-4 h-4" />
                                    Edit Lesson
                                  </ContextMenuItem>
                                  <ContextMenuItem
                                    variant="destructive"
                                    onSelect={() => {
                                      deleteLessonFetcher.submit(
                                        { lessonId: lesson.id },
                                        {
                                          method: "post",
                                          action: "/api/lessons/delete",
                                        }
                                      );
                                    }}
                                  >
                                    <Trash2 className="w-4 h-4" />
                                    Delete
                                  </ContextMenuItem>
                                </ContextMenuContent>
                              </ContextMenu>
                              <AddVideoModal
                                lessonId={lesson.id}
                                videoCount={lesson.videos.length}
                                hasExplainerFolder={
                                  data.hasExplainerFolderMap[lesson.id] ?? false
                                }
                                open={addVideoToLessonId === lesson.id}
                                onOpenChange={(open) => {
                                  setAddVideoToLessonId(
                                    open ? lesson.id : null
                                  );
                                }}
                              />
                              <EditLessonModal
                                lessonId={lesson.id}
                                currentPath={lesson.path}
                                open={editLessonId === lesson.id}
                                onOpenChange={(open) => {
                                  setEditLessonId(open ? lesson.id : null);
                                }}
                              />
                              <div className="ml-5 space-y-0.5">
                                {lesson.videos.map((video) => {
                                  const totalDuration = video.clips.reduce(
                                    (acc, clip) => {
                                      return (
                                        acc +
                                        (clip.sourceEndTime -
                                          clip.sourceStartTime)
                                      );
                                    },
                                    0
                                  );

                                  return (
                                    <ContextMenu key={video.id}>
                                      <ContextMenuTrigger asChild>
                                        <button
                                          className="flex items-center justify-between text-xs py-1 px-2 rounded hover:bg-muted/50 transition-colors cursor-context-menu w-full text-left"
                                          onMouseDown={(e) => {
                                            if (!isLeftClick(e)) return;
                                            navigate(
                                              `/videos/${video.id}/edit`
                                            );
                                          }}
                                        >
                                          <div className="flex items-center gap-1.5 min-w-0">
                                            <FileVideo
                                              className={cn(
                                                "w-3 h-3 shrink-0",
                                                data.hasExportedVideoMap[
                                                  video.id
                                                ]
                                                  ? "text-muted-foreground"
                                                  : "text-red-500"
                                              )}
                                            />
                                            <span className="truncate text-muted-foreground">
                                              {video.path}
                                            </span>
                                          </div>
                                          <span className="text-muted-foreground font-mono ml-2 shrink-0">
                                            {formatSecondsToTimeCode(
                                              totalDuration
                                            )}
                                          </span>
                                        </button>
                                      </ContextMenuTrigger>
                                      <ContextMenuContent>
                                        <ContextMenuItem
                                          onSelect={() => {
                                            setVideoPlayerState({
                                              isOpen: true,
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
                                            setRenameVideoState({
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
                                            setMoveVideoState({
                                              videoId: video.id,
                                              videoPath: video.path,
                                              currentLessonId: lesson.id,
                                            });
                                          }}
                                        >
                                          <ArrowRightLeft className="w-4 h-4" />
                                          Move to Lesson
                                        </ContextMenuItem>
                                        <ContextMenuItem
                                          variant="destructive"
                                          onSelect={() => {
                                            deleteVideoFileFetcher.submit(
                                              {},
                                              {
                                                method: "post",
                                                action: `/api/videos/${video.id}/delete-file`,
                                              }
                                            );
                                          }}
                                        >
                                          <FileX className="w-4 h-4" />
                                          Delete from File System
                                        </ContextMenuItem>
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
                                })}
                              </div>
                            </div>
                          </React.Fragment>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="max-w-4xl mx-auto">
              <div className="mb-8">
                <h1 className="text-2xl font-bold mb-2">
                  Course Video Manager
                </h1>
                <p className="text-sm text-muted-foreground">
                  Select a repository
                </p>
              </div>

              {/* Recent Unattached Videos */}
              {data.standaloneVideos.length > 0 && (
                <div className="mb-8">
                  <h2 className="text-lg font-semibold mb-4">
                    Recent Unattached Videos
                  </h2>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {data.standaloneVideos.slice(0, 3).map((video) => {
                      const totalDuration = video.clips.reduce(
                        (acc, clip) =>
                          acc + (clip.sourceEndTime - clip.sourceStartTime),
                        0
                      );
                      return (
                        <Link
                          key={video.id}
                          to={`/videos/${video.id}/edit`}
                          className="block border rounded-lg p-4 hover:border-primary/50 transition-colors"
                          onClick={(e) => e.preventDefault()}
                          onMouseDown={(e) => {
                            if (e.button === 0)
                              navigate(`/videos/${video.id}/edit`);
                          }}
                        >
                          <div className="flex items-center gap-2 mb-2">
                            <VideoIcon className="w-4 h-4 text-muted-foreground" />
                            <span className="text-sm font-medium truncate">
                              {video.path}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {formatSecondsToTimeCode(totalDuration)}
                          </p>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {repos.map((repo) => (
                  <Link
                    key={repo.id}
                    to={`?repoId=${repo.id}`}
                    className="block border rounded-lg p-6 hover:border-primary/50 transition-colors cursor-pointer"
                    onClick={(e) => e.preventDefault()}
                    onMouseDown={(e) => {
                      if (e.button === 0) navigate(`?repoId=${repo.id}`);
                    }}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <h3 className="text-lg font-semibold">{repo.name}</h3>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {repo.filePath}
                    </p>
                  </Link>
                ))}
              </div>

              {repos.length === 0 && (
                <div className="text-center py-12">
                  <div className="mb-4">
                    <VideoIcon className="w-16 h-16 mx-auto text-muted-foreground/50" />
                  </div>
                  <h3 className="text-xl font-semibold mb-2">
                    No repositories found
                  </h3>
                  <p className="text-muted-foreground mb-6">
                    Get started by adding your first repository
                  </p>
                  <Button
                    onClick={() => setIsAddRepoModalOpen(true)}
                    className="mx-auto"
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    Add Repository
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <VideoModal
        videoId={videoPlayerState.videoId}
        videoPath={videoPlayerState.videoPath}
        isOpen={videoPlayerState.isOpen}
        onClose={() => {
          setVideoPlayerState({
            isOpen: false,
            videoId: "",
            videoPath: "",
          });
        }}
      />

      {currentRepo && data.selectedVersion && (
        <CreateVersionModal
          repoId={currentRepo.id}
          sourceVersionId={data.selectedVersion.id}
          isOpen={isCreateVersionModalOpen}
          onOpenChange={setIsCreateVersionModalOpen}
        />
      )}

      {currentRepo && data.selectedVersion && (
        <RenameVersionModal
          repoId={currentRepo.id}
          versionId={data.selectedVersion.id}
          currentName={data.selectedVersion.name}
          open={isRenameVersionModalOpen}
          onOpenChange={setIsRenameVersionModalOpen}
        />
      )}

      {currentRepo && (
        <RenameRepoModal
          repoId={currentRepo.id}
          currentName={currentRepo.name}
          open={isRenameRepoModalOpen}
          onOpenChange={setIsRenameRepoModalOpen}
        />
      )}

      {selectedRepoId && data.versions.length > 0 && (
        <VersionSelectorModal
          versions={data.versions}
          selectedVersionId={data.selectedVersion?.id}
          isOpen={isVersionSelectorModalOpen}
          onOpenChange={setIsVersionSelectorModalOpen}
          onSelectVersion={(versionId) => {
            navigate(`?repoId=${selectedRepoId}&versionId=${versionId}`, {
              preventScrollReset: true,
            });
          }}
        />
      )}

      {currentRepo && data.selectedVersion && data.versions.length > 1 && (
        <DeleteVersionModal
          repoId={currentRepo.id}
          versionId={data.selectedVersion.id}
          versionName={data.selectedVersion.name}
          open={isDeleteVersionModalOpen}
          onOpenChange={setIsDeleteVersionModalOpen}
        />
      )}

      {currentRepo && data.selectedVersion && (
        <ClearVideoFilesModal
          repoId={currentRepo.id}
          versionId={data.selectedVersion.id}
          versionName={data.selectedVersion.name}
          open={isClearVideoFilesModalOpen}
          onOpenChange={setIsClearVideoFilesModalOpen}
        />
      )}

      {currentRepo && (
        <RewriteRepoPathModal
          repoId={currentRepo.id}
          currentPath={currentRepo.filePath}
          open={isRewriteRepoPathModalOpen}
          onOpenChange={setIsRewriteRepoPathModalOpen}
        />
      )}

      {moveVideoState && currentRepo && (
        <MoveVideoModal
          videoId={moveVideoState.videoId}
          videoPath={moveVideoState.videoPath}
          currentLessonId={moveVideoState.currentLessonId}
          sections={currentRepo.sections}
          open={true}
          onOpenChange={(open) => {
            if (!open) setMoveVideoState(null);
          }}
        />
      )}

      {renameVideoState && (
        <RenameVideoModal
          videoId={renameVideoState.videoId}
          currentName={renameVideoState.videoPath}
          open={true}
          onOpenChange={(open) => {
            if (!open) setRenameVideoState(null);
          }}
        />
      )}
    </div>
  );
}
