"use client";

import { AppSidebar } from "@/components/app-sidebar";
import { AddGhostLessonModal } from "@/components/add-ghost-lesson-modal";
import { AddLessonModal } from "@/components/add-lesson-modal";
import { AddVideoModal } from "@/components/add-video-modal";
import { ClearVideoFilesModal } from "@/components/clear-video-files-modal";
import { CreateVersionModal } from "@/components/create-version-modal";
import { DeleteVersionModal } from "@/components/delete-version-modal";
import {
  DependencySelector,
  type DependencyLessonItem,
} from "@/components/dependency-selector";
import { EditGhostLessonModal } from "@/components/edit-ghost-lesson-modal";
import { EditLessonModal } from "@/components/edit-lesson-modal";
import { MoveVideoModal } from "@/components/move-video-modal";
import { RenameVideoModal } from "@/components/rename-video-modal";
import { RenameRepoModal } from "@/components/rename-repo-modal";
import { RewriteRepoPathModal } from "@/components/rewrite-repo-path-modal";
import { EditVersionModal } from "@/components/edit-version-modal";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
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
import { Textarea } from "@/components/ui/textarea";
import { cn, isLeftClick } from "@/lib/utils";
import { DBFunctionsService } from "@/services/db-service.server";
import { FeatureFlagService } from "@/services/feature-flag-service";
import { runtimeLive } from "@/services/layer.server";
import { formatSecondsToTimeCode } from "@/services/utils";
import { FileSystem } from "@effect/platform";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  rectSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
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
  Code,
  Ghost,
  GripVertical,
  Loader2,
  MessageCircle,
  PencilIcon,
  Play,
  Plus,
  Send,
  Trash2,
  VideoIcon,
} from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react";
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
        section.lessons
          .filter((lesson) => lesson.fsStatus !== "ghost")
          .map((lesson) => ({
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
  const [addLessonSectionId, setAddLessonSectionId] = useState<string | null>(
    null
  );
  const [addGhostLessonSectionId, setAddGhostLessonSectionId] = useState<
    string | null
  >(null);
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
  const [isEditVersionModalOpen, setIsEditVersionModalOpen] = useState(false);
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

  const [priorityFilter, setPriorityFilter] = useState<number[]>([]);
  const [iconFilter, setIconFilter] = useState<string[]>([]);

  const togglePriorityFilter = useCallback((priority: number) => {
    setPriorityFilter((prev) =>
      prev.includes(priority)
        ? prev.filter((p) => p !== priority)
        : [...prev, priority]
    );
  }, []);

  const toggleIconFilter = useCallback((icon: string) => {
    setIconFilter((prev) =>
      prev.includes(icon) ? prev.filter((i) => i !== icon) : [...prev, icon]
    );
  }, []);

  const publishRepoFetcher = useFetcher();
  const { startExportUpload, startBatchExportUpload } =
    useContext(UploadContext);

  useFocusRevalidate({ enabled: !!selectedRepoId, intervalMs: 5000 });

  const deleteVideoFetcher = useFetcher();
  const deleteVideoFileFetcher = useFetcher();
  const deleteLessonFetcher = useFetcher();
  const revealVideoFetcher = useFetcher();
  const archiveRepoFetcher = useFetcher();
  const reorderLessonFetcher = useFetcher();
  const reorderSectionFetcher = useFetcher();
  const addGhostFetcher = useFetcher();

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleLessonDragEnd = useCallback(
    (sectionId: string, lessons: { id: string }[]) => (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const fromIndex = lessons.findIndex((l) => l.id === active.id);
      const toIndex = lessons.findIndex((l) => l.id === over.id);
      if (fromIndex === -1 || toIndex === -1) return;

      const newOrder = arrayMove(lessons, fromIndex, toIndex);

      reorderLessonFetcher.submit(
        {
          sectionId,
          lessonIds: JSON.stringify(newOrder.map((l) => l.id)),
        },
        { method: "post", action: "/api/lessons/reorder" }
      );
    },
    [reorderLessonFetcher]
  );

  const handleSectionDragEnd = useCallback(
    (sections: { id: string }[], repoVersionId: string) =>
      (event: DragEndEvent) => {
        const { active, over } = event;
        if (!over || active.id === over.id) return;

        const fromIndex = sections.findIndex((s) => s.id === active.id);
        const toIndex = sections.findIndex((s) => s.id === over.id);
        if (fromIndex === -1 || toIndex === -1) return;

        const newOrder = arrayMove(sections, fromIndex, toIndex);

        reorderSectionFetcher.submit(
          {
            repoVersionId,
            sectionIds: JSON.stringify(newOrder.map((s) => s.id)),
          },
          { method: "post", action: "/api/sections/reorder" }
        );
      },
    [reorderSectionFetcher]
  );

  const data = props.loaderData;

  const repos = data.repos;

  const currentRepo = data.selectedRepo;

  const totalLessonsWithVideos =
    data.selectedRepo?.sections.reduce((acc, section) => {
      return (
        acc +
        section.lessons.filter(
          (lesson) => lesson.fsStatus !== "ghost" && lesson.videos.length > 0
        ).length
      );
    }, 0) ?? 0;

  const totalLessons =
    data.selectedRepo?.sections.reduce((acc, section) => {
      return (
        acc +
        section.lessons.filter((lesson) => lesson.fsStatus !== "ghost").length
      );
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

  const totalDurationSeconds =
    data.selectedRepo?.sections.reduce((acc, section) => {
      return (
        acc +
        section.lessons.reduce((lessonAcc, lesson) => {
          return (
            lessonAcc +
            lesson.videos.reduce((videoAcc, video) => {
              return (
                videoAcc +
                video.clips.reduce((clipAcc, clip) => {
                  return clipAcc + (clip.sourceEndTime - clip.sourceStartTime);
                }, 0)
              );
            }, 0)
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
                    {totalDurationSeconds > 0 && (
                      <span className="inline-flex items-center rounded-md bg-secondary px-2 py-1 text-xs font-medium text-secondary-foreground">
                        {totalDurationFormatted}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      Filter:
                    </span>
                    {([1, 2, 3] as const).map((priority) => {
                      const isSelected = priorityFilter.includes(priority);
                      const showAsActive =
                        priorityFilter.length === 0 || isSelected;
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
                          onClick={() => togglePriorityFilter(priority)}
                        >
                          P{priority}
                        </button>
                      );
                    })}

                    <span className="text-muted-foreground mx-1">|</span>
                    {(["code", "discussion", "watch"] as const).map((icon) => {
                      const isSelected = iconFilter.includes(icon);
                      const showAsActive =
                        iconFilter.length === 0 || isSelected;
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
                          onClick={() => toggleIconFilter(icon)}
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
                              onSelect={() => setIsEditVersionModalOpen(true)}
                            >
                              <PencilIcon className="w-4 h-4 mr-2" />
                              <div className="flex flex-col">
                                <span className="font-medium">
                                  Edit Version
                                </span>
                                <span className="text-xs text-muted-foreground">
                                  Change version name and description
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

              {(() => {
                // Optimistic section reordering
                let displaySections = currentRepo.sections;
                const pendingSectionReorder = reorderSectionFetcher.formData;
                if (pendingSectionReorder) {
                  const sectionIds = JSON.parse(
                    pendingSectionReorder.get("sectionIds") as string
                  ) as string[];
                  const sectionMap = new Map(
                    currentRepo.sections.map((s) => [s.id, s])
                  );
                  const reordered = sectionIds
                    .map((id) => sectionMap.get(id))
                    .filter(Boolean) as typeof currentRepo.sections;
                  if (reordered.length === currentRepo.sections.length) {
                    displaySections = reordered;
                  }
                }

                // Build flat lessons list for dependency selector
                const allFlatLessons: DependencyLessonItem[] =
                  displaySections.flatMap((section, sectionIdx) =>
                    section.lessons.map((lesson, lessonIdx) => ({
                      id: lesson.id,
                      number: `${sectionIdx + 1}.${lessonIdx + 1}`,
                      title: lesson.title || lesson.path,
                      sectionId: section.id,
                      sectionTitle: section.path,
                      sectionNumber: sectionIdx + 1,
                    }))
                  );

                // Build dependency map for circular dependency detection
                const dependencyMap: Record<string, string[]> = {};
                for (const section of displaySections) {
                  for (const lesson of section.lessons) {
                    if (lesson.dependencies && lesson.dependencies.length > 0) {
                      dependencyMap[lesson.id] = lesson.dependencies;
                    }
                  }
                }

                return (
                  <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={handleSectionDragEnd(
                      displaySections,
                      data.selectedVersion!.id
                    )}
                  >
                    <SortableContext
                      items={displaySections.map((s) => s.id)}
                      strategy={rectSortingStrategy}
                    >
                      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
                        {displaySections.map((section) => {
                          // Optimistic lesson reordering
                          let lessons = section.lessons;
                          const pendingReorder = reorderLessonFetcher.formData;
                          if (
                            pendingReorder &&
                            pendingReorder.get("sectionId") === section.id
                          ) {
                            const lessonIds = JSON.parse(
                              pendingReorder.get("lessonIds") as string
                            ) as string[];
                            const lessonMap = new Map(
                              section.lessons.map((l) => [l.id, l])
                            );
                            const reordered = lessonIds
                              .map((id) => lessonMap.get(id))
                              .filter(Boolean) as typeof section.lessons;
                            if (reordered.length === section.lessons.length) {
                              lessons = reordered;
                            }
                          }

                          // Optimistic lesson deletion
                          const pendingDelete = deleteLessonFetcher.formData;
                          const pendingDeleteId = pendingDelete?.get(
                            "lessonId"
                          ) as string | null;
                          if (pendingDeleteId) {
                            lessons = lessons.filter(
                              (l) => l.id !== pendingDeleteId
                            );
                          }

                          // Optimistic ghost lesson addition
                          const pendingGhostAdd = addGhostFetcher.formData;
                          if (
                            pendingGhostAdd &&
                            pendingGhostAdd.get("sectionId") === section.id
                          ) {
                            const ghostTitle = pendingGhostAdd.get(
                              "title"
                            ) as string;
                            lessons = [
                              ...lessons,
                              {
                                id: `optimistic-ghost-${ghostTitle}`,
                                path: ghostTitle,
                                title: ghostTitle,
                                fsStatus: "ghost",
                                description: "",
                                icon: null,
                                priority: 2,
                                dependencies: [],
                                order: lessons.length,
                                videos: [],
                                createdAt: new Date(),
                                previousVersionLessonId: null,
                                sectionId: section.id,
                              } as Lesson,
                            ];
                          }

                          // Filter lessons based on active filters
                          const hasActiveFilters =
                            priorityFilter.length > 0 || iconFilter.length > 0;
                          const filteredLessons = hasActiveFilters
                            ? lessons.filter((lesson) => {
                                const passesPriorityFilter =
                                  priorityFilter.length === 0 ||
                                  priorityFilter.includes(lesson.priority ?? 2);
                                const passesIconFilter =
                                  iconFilter.length === 0 ||
                                  iconFilter.includes(lesson.icon ?? "watch");
                                return passesPriorityFilter && passesIconFilter;
                              })
                            : lessons;

                          const sectionDuration = lessons.reduce(
                            (acc, lesson) => {
                              return (
                                acc +
                                lesson.videos.reduce((videoAcc, video) => {
                                  return (
                                    videoAcc +
                                    video.clips.reduce((clipAcc, clip) => {
                                      return (
                                        clipAcc +
                                        (clip.sourceEndTime -
                                          clip.sourceStartTime)
                                      );
                                    }, 0)
                                  );
                                }, 0)
                              );
                            },
                            0
                          );

                          const isGhostSection =
                            lessons.length === 0 ||
                            lessons.every((l) => l.fsStatus === "ghost");

                          return (
                            <SortableSectionItem
                              key={section.id}
                              id={section.id}
                            >
                              {(dragHandleListeners) => (
                                <>
                                  <ContextMenu>
                                    <ContextMenuTrigger asChild>
                                      <div className="px-4 py-3 border-b bg-muted/30 cursor-context-menu">
                                        <div className="flex items-center justify-between">
                                          <div className="flex items-center gap-2">
                                            <button
                                              className="cursor-grab active:cursor-grabbing text-muted-foreground/50 hover:text-muted-foreground touch-none"
                                              {...dragHandleListeners}
                                            >
                                              <GripVertical className="w-4 h-4" />
                                            </button>
                                            <h2
                                              className={cn(
                                                "font-medium text-sm",
                                                isGhostSection &&
                                                  "text-muted-foreground/70 italic"
                                              )}
                                            >
                                              {section.path}
                                            </h2>
                                            {isGhostSection && (
                                              <Ghost className="w-3.5 h-3.5 text-muted-foreground/40" />
                                            )}
                                          </div>
                                          <Badge
                                            variant="secondary"
                                            className="text-[10px]"
                                          >
                                            {formatSecondsToTimeCode(
                                              sectionDuration
                                            )}
                                          </Badge>
                                        </div>
                                      </div>
                                    </ContextMenuTrigger>
                                    <ContextMenuContent>
                                      <ContextMenuItem
                                        onSelect={() =>
                                          setAddLessonSectionId(section.id)
                                        }
                                      >
                                        <Plus className="w-4 h-4" />
                                        Add Lesson
                                      </ContextMenuItem>
                                      <ContextMenuItem
                                        onSelect={() =>
                                          setAddGhostLessonSectionId(section.id)
                                        }
                                      >
                                        <Ghost className="w-4 h-4" />
                                        Add Ghost Lesson
                                      </ContextMenuItem>
                                    </ContextMenuContent>
                                  </ContextMenu>
                                  <AddLessonModal
                                    sectionId={section.id}
                                    open={addLessonSectionId === section.id}
                                    onOpenChange={(open) => {
                                      setAddLessonSectionId(
                                        open ? section.id : null
                                      );
                                    }}
                                  />
                                  <AddGhostLessonModal
                                    sectionId={section.id}
                                    open={
                                      addGhostLessonSectionId === section.id
                                    }
                                    onOpenChange={(open) => {
                                      setAddGhostLessonSectionId(
                                        open ? section.id : null
                                      );
                                    }}
                                    fetcher={addGhostFetcher}
                                  />
                                  <div className="p-2">
                                    <DndContext
                                      sensors={sensors}
                                      collisionDetection={closestCenter}
                                      onDragEnd={handleLessonDragEnd(
                                        section.id,
                                        lessons
                                      )}
                                    >
                                      <SortableContext
                                        items={lessons.map((l) => l.id)}
                                        strategy={verticalListSortingStrategy}
                                      >
                                        {hasActiveFilters &&
                                          filteredLessons.length === 0 && (
                                            <p className="text-xs text-muted-foreground text-center py-3">
                                              No matching lessons
                                            </p>
                                          )}
                                        {filteredLessons.map((lesson, li) => (
                                          <SortableLessonItem
                                            key={lesson.id}
                                            lesson={lesson}
                                            lessonIndex={li}
                                            section={section}
                                            data={data}
                                            navigate={navigate}
                                            allFlatLessons={allFlatLessons}
                                            setAddVideoToLessonId={
                                              setAddVideoToLessonId
                                            }
                                            addVideoToLessonId={
                                              addVideoToLessonId
                                            }
                                            setEditLessonId={setEditLessonId}
                                            editLessonId={editLessonId}
                                            setVideoPlayerState={
                                              setVideoPlayerState
                                            }
                                            startExportUpload={
                                              startExportUpload
                                            }
                                            revealVideoFetcher={
                                              revealVideoFetcher
                                            }
                                            setRenameVideoState={
                                              setRenameVideoState
                                            }
                                            setMoveVideoState={
                                              setMoveVideoState
                                            }
                                            deleteVideoFileFetcher={
                                              deleteVideoFileFetcher
                                            }
                                            deleteVideoFetcher={
                                              deleteVideoFetcher
                                            }
                                            deleteLessonFetcher={
                                              deleteLessonFetcher
                                            }
                                            dependencyMap={dependencyMap}
                                          />
                                        ))}
                                      </SortableContext>
                                    </DndContext>
                                  </div>
                                </>
                              )}
                            </SortableSectionItem>
                          );
                        })}
                      </div>
                    </SortableContext>
                  </DndContext>
                );
              })()}
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
        <EditVersionModal
          repoId={currentRepo.id}
          versionId={data.selectedVersion.id}
          currentName={data.selectedVersion.name}
          currentDescription={data.selectedVersion.description}
          open={isEditVersionModalOpen}
          onOpenChange={setIsEditVersionModalOpen}
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

type LoaderData = Route.ComponentProps["loaderData"];
type Section = NonNullable<LoaderData["selectedRepo"]>["sections"][number];
type Lesson = Section["lessons"][number];

function SortableSectionItem({
  id,
  children,
}: {
  id: string;
  children: (
    dragHandleListeners: ReturnType<typeof useSortable>["listeners"]
  ) => ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      className="rounded-lg border bg-card"
    >
      {children(listeners)}
    </div>
  );
}

function SortableLessonItem({
  lesson,
  lessonIndex,
  section,
  data,
  navigate,
  setAddVideoToLessonId,
  addVideoToLessonId,
  setEditLessonId,
  editLessonId,
  setVideoPlayerState,
  startExportUpload,
  revealVideoFetcher,
  setRenameVideoState,
  setMoveVideoState,
  deleteVideoFileFetcher,
  deleteVideoFetcher,
  deleteLessonFetcher,
  allFlatLessons,
  dependencyMap,
}: {
  lesson: Lesson;
  lessonIndex: number;
  section: Section;
  data: LoaderData;
  navigate: ReturnType<typeof useNavigate>;
  setAddVideoToLessonId: (id: string | null) => void;
  addVideoToLessonId: string | null;
  setEditLessonId: (id: string | null) => void;
  editLessonId: string | null;
  setVideoPlayerState: (state: {
    isOpen: boolean;
    videoId: string;
    videoPath: string;
  }) => void;
  startExportUpload: (videoId: string, path: string) => void;
  revealVideoFetcher: ReturnType<typeof useFetcher>;
  setRenameVideoState: (
    state: { videoId: string; videoPath: string } | null
  ) => void;
  setMoveVideoState: (
    state: {
      videoId: string;
      videoPath: string;
      currentLessonId: string;
    } | null
  ) => void;
  deleteVideoFileFetcher: ReturnType<typeof useFetcher>;
  deleteVideoFetcher: ReturnType<typeof useFetcher>;
  deleteLessonFetcher: ReturnType<typeof useFetcher>;
  allFlatLessons: DependencyLessonItem[];
  dependencyMap: Record<string, string[]>;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: lesson.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
  };

  const createOnDiskFetcher = useFetcher();
  const isGhost =
    lesson.fsStatus === "ghost" && createOnDiskFetcher.state === "idle";
  const descriptionFetcher = useFetcher();
  const [editingDesc, setEditingDesc] = useState(false);
  const [descValue, setDescValue] = useState(lesson.description || "");
  const descTextareaRef = useRef<HTMLTextAreaElement>(null);
  const dependencyFetcher = useFetcher();

  // Dependency violation checking
  const lessonDeps = lesson.dependencies ?? [];
  const flatLessonIdx = allFlatLessons.findIndex((l) => l.id === lesson.id);
  const orderViolations = lessonDeps
    .map((depId) => {
      const depIdx = allFlatLessons.findIndex((l) => l.id === depId);
      if (depIdx > flatLessonIdx) {
        const dep = allFlatLessons[depIdx];
        return dep ? { number: dep.number } : null;
      }
      return null;
    })
    .filter(Boolean) as { number: string }[];
  const lessonPriority = lesson.priority ?? 2;
  const priorityViolations = lessonDeps
    .map((depId) => {
      const dep = allFlatLessons.find((l) => l.id === depId);
      if (!dep) return null;
      // Find the actual lesson to get its priority
      const depLesson = data.selectedRepo?.sections
        .flatMap((s) => s.lessons)
        .find((l) => l.id === depId);
      const depPriority = depLesson?.priority ?? 2;
      if (depPriority > lessonPriority) {
        return { number: dep.number, priority: depPriority };
      }
      return null;
    })
    .filter(Boolean) as { number: string; priority: number }[];

  const handleDependenciesChange = useCallback(
    (newDeps: string[]) => {
      dependencyFetcher.submit(
        { dependencies: JSON.stringify(newDeps) },
        {
          method: "post",
          action: `/api/lessons/${lesson.id}/update-dependencies`,
        }
      );
    },
    [lesson.id, dependencyFetcher]
  );

  const saveDescription = useCallback(
    (value: string) => {
      setEditingDesc(false);
      if (value !== (lesson.description || "")) {
        descriptionFetcher.submit(
          { description: value },
          {
            method: "post",
            action: `/api/lessons/${lesson.id}/update-description`,
          }
        );
      }
    },
    [lesson.description, lesson.id, descriptionFetcher]
  );

  return (
    <div ref={setNodeRef} style={style}>
      <a id={lesson.id} />
      {lessonIndex > 0 && <Separator className="my-1" />}
      <div
        className={cn(
          "rounded-md px-2 py-2 group",
          isGhost &&
            "border border-dashed border-muted-foreground/30 bg-muted/20"
        )}
      >
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div className="flex items-center gap-2 mb-1.5 cursor-context-menu hover:bg-muted/50 rounded px-1 py-0.5 transition-colors">
              <button
                className="cursor-grab active:cursor-grabbing p-0.5 -ml-1 touch-none"
                {...attributes}
                {...listeners}
              >
                <GripVertical className="w-3.5 h-3.5 text-muted-foreground" />
              </button>
              <BookOpen
                className={cn(
                  "w-3.5 h-3.5 text-muted-foreground shrink-0",
                  isGhost && "opacity-50"
                )}
              />
              <span
                className={cn(
                  "text-sm font-medium truncate",
                  isGhost && "text-muted-foreground/70 italic"
                )}
              >
                {lesson.title || lesson.path}
              </span>
              {isGhost && (
                <span className="flex items-center gap-1 text-xs text-muted-foreground/60 px-1.5 py-0.5 rounded-sm bg-muted/50 shrink-0">
                  <Ghost className="w-3 h-3" />
                  Ghost
                </span>
              )}
              {lesson.priority !== undefined && lesson.priority !== 2 && (
                <span
                  className={cn(
                    "flex-shrink-0 text-xs px-2 py-0.5 rounded-sm font-medium",
                    lesson.priority === 1
                      ? "bg-red-500/20 text-red-600"
                      : "bg-sky-500/20 text-sky-500"
                  )}
                >
                  P{lesson.priority}
                </span>
              )}
              <DependencySelector
                lessonId={lesson.id}
                dependencies={lessonDeps}
                allLessons={allFlatLessons}
                onDependenciesChange={handleDependenciesChange}
                orderViolations={orderViolations}
                priorityViolations={priorityViolations}
                lessonPriority={lessonPriority}
                dependencyMap={dependencyMap}
              />
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent>
            {isGhost ? (
              <>
                <ContextMenuItem
                  onSelect={() => {
                    createOnDiskFetcher.submit(null, {
                      method: "post",
                      action: `/api/lessons/${lesson.id}/create-on-disk`,
                    });
                  }}
                >
                  <BookOpen className="w-4 h-4" />
                  Create on Disk
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem onSelect={() => setEditLessonId(lesson.id)}>
                  <PencilIcon className="w-4 h-4" />
                  Rename
                </ContextMenuItem>
              </>
            ) : (
              <>
                <ContextMenuItem
                  onSelect={() => setAddVideoToLessonId(lesson.id)}
                >
                  <Plus className="w-4 h-4" />
                  Add Video
                </ContextMenuItem>
                <ContextMenuItem onSelect={() => setEditLessonId(lesson.id)}>
                  <PencilIcon className="w-4 h-4" />
                  Rename Lesson
                </ContextMenuItem>
              </>
            )}
            <ContextMenuItem
              onSelect={() => {
                setDescValue(lesson.description || "");
                setEditingDesc(true);
              }}
            >
              <FileText className="w-4 h-4" />
              Edit Description
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
        <div className="ml-5">
          {editingDesc ? (
            <div className="mt-1">
              <Textarea
                ref={descTextareaRef}
                value={descValue}
                onChange={(e) => setDescValue(e.target.value)}
                placeholder="What should this lesson teach?"
                className="text-sm min-h-[60px]"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setDescValue(lesson.description || "");
                    setEditingDesc(false);
                  }
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                    saveDescription(descValue);
                  }
                }}
                onBlur={() => saveDescription(descValue)}
              />
            </div>
          ) : lesson.description ? (
            <p
              className="text-xs text-muted-foreground mt-1 cursor-pointer hover:text-foreground/70"
              onClick={() => {
                setDescValue(lesson.description || "");
                setEditingDesc(true);
              }}
            >
              {lesson.description}
            </p>
          ) : (
            <button
              className="text-xs text-muted-foreground/50 mt-1 hover:text-muted-foreground transition-colors"
              onClick={() => {
                setDescValue("");
                setEditingDesc(true);
              }}
            >
              + Add description
            </button>
          )}
        </div>
        <AddVideoModal
          lessonId={lesson.id}
          videoCount={lesson.videos.length}
          hasExplainerFolder={data.hasExplainerFolderMap[lesson.id] ?? false}
          open={addVideoToLessonId === lesson.id}
          onOpenChange={(open) => {
            setAddVideoToLessonId(open ? lesson.id : null);
          }}
        />
        {isGhost ? (
          <EditGhostLessonModal
            lessonId={lesson.id}
            currentTitle={lesson.title || lesson.path}
            open={editLessonId === lesson.id}
            onOpenChange={(open) => {
              setEditLessonId(open ? lesson.id : null);
            }}
          />
        ) : (
          <EditLessonModal
            lessonId={lesson.id}
            currentPath={lesson.path}
            open={editLessonId === lesson.id}
            onOpenChange={(open) => {
              setEditLessonId(open ? lesson.id : null);
            }}
          />
        )}
        <div className="ml-5 space-y-0.5">
          {lesson.videos.map((video) => {
            const totalDuration = video.clips.reduce((acc, clip) => {
              return acc + (clip.sourceEndTime - clip.sourceStartTime);
            }, 0);

            return (
              <ContextMenu key={video.id}>
                <ContextMenuTrigger asChild>
                  <button
                    className="flex items-center justify-between text-xs py-1 px-2 rounded hover:bg-muted/50 transition-colors cursor-context-menu w-full text-left"
                    onMouseDown={(e) => {
                      if (!isLeftClick(e)) return;
                      navigate(`/videos/${video.id}/edit`);
                    }}
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      <FileVideo
                        className={cn(
                          "w-3 h-3 shrink-0",
                          data.hasExportedVideoMap[video.id]
                            ? "text-muted-foreground"
                            : "text-red-500"
                        )}
                      />
                      <span className="truncate text-muted-foreground">
                        {video.path}
                      </span>
                    </div>
                    <span className="text-muted-foreground font-mono ml-2 shrink-0">
                      {formatSecondsToTimeCode(totalDuration)}
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
    </div>
  );
}
