"use client";

import { AppSidebar } from "@/components/app-sidebar";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Separator } from "@/components/ui/separator";
import { cn, isLeftClick } from "@/lib/utils";
import { DBFunctionsService } from "@/services/db-service.server";
import { runtimeLive } from "@/services/layer.server";
import { formatSecondsToTimeCode } from "@/services/utils";
import { getVideoPath } from "@/lib/get-video";
import { FileSystem } from "@effect/platform";
import { Console, Effect } from "effect";
import {
  BookOpen,
  FileVideo,
  FolderOpen,
  PencilIcon,
  Play,
  Plus,
  Trash2,
} from "lucide-react";
import React, { useState } from "react";
import {
  data,
  Link,
  useFetcher,
  useNavigate,
  useSearchParams,
} from "react-router";
import type { Route } from "./+types/tabbed";
import { AddVideoModal } from "@/components/add-video-modal";
import { EditLessonModal } from "@/components/edit-lesson-modal";
import { VideoModal } from "@/components/video-player";

export const meta: Route.MetaFunction = ({ data }) => {
  const selectedRepo = data?.selectedRepo;

  if (selectedRepo) {
    return [{ title: `CVM - ${selectedRepo.name} (Tabbed)` }];
  }

  return [{ title: "CVM (Tabbed)" }];
};

export const loader = async (args: Route.LoaderArgs) => {
  const url = new URL(args.request.url);
  const selectedRepoId = url.searchParams.get("repoId");
  const selectedVersionId = url.searchParams.get("versionId");

  return Effect.gen(function* () {
    const db = yield* DBFunctionsService;
    const fs = yield* FileSystem.FileSystem;

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

            const versionData =
              repo.versions.find((v) => v.id === selectedVersion?.id) ??
              repo.versions[0];
            const allSections = versionData?.sections ?? [];

            return {
              ...repo,
              sections: allSections
                .filter((section) => !section.path.endsWith("ARCHIVE"))
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

    return {
      repos,
      standaloneVideos,
      selectedRepo,
      versions,
      selectedVersion,
      hasExportedVideoMap,
      hasExplainerFolderMap,
      plans,
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

export default function TabbedComponent(props: Route.ComponentProps) {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const selectedRepoId = searchParams.get("repoId");
  const sectionParam = searchParams.get("section");

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

  const deleteVideoFetcher = useFetcher();
  const deleteLessonFetcher = useFetcher();
  const revealVideoFetcher = useFetcher();

  const loaderData = props.loaderData;
  const currentRepo = loaderData.selectedRepo;

  const sections = currentRepo?.sections ?? [];
  const defaultSection = sections[0]?.id ?? "";
  const activeSection = sectionParam ?? defaultSection;

  const setActiveSection = (sectionId: string) => {
    const params = new URLSearchParams(searchParams);
    params.set("section", sectionId);
    navigate(`/tabbed?${params.toString()}`, { preventScrollReset: true });
  };

  return (
    <div className="flex h-screen bg-background text-foreground">
      <AppSidebar
        repos={loaderData.repos}
        standaloneVideos={loaderData.standaloneVideos}
        selectedRepoId={selectedRepoId}
        isAddRepoModalOpen={false}
        setIsAddRepoModalOpen={() => {}}
        isAddStandaloneVideoModalOpen={false}
        setIsAddStandaloneVideoModalOpen={() => {}}
        plans={loaderData.plans}
      />

      <div className="flex-1 overflow-y-auto">
        <div className="p-6">
          {currentRepo ? (
            <>
              <div className="mb-6">
                <div className="flex items-center gap-3 mb-1">
                  <h1 className="text-2xl font-bold">{currentRepo.name}</h1>
                  <Link
                    to={`/?repoId=${currentRepo.id}${loaderData.selectedVersion ? `&versionId=${loaderData.selectedVersion.id}` : ""}`}
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Grid View
                  </Link>
                </div>
              </div>

              <Tabs value={activeSection} onValueChange={setActiveSection}>
                <TabsList className="w-full justify-start flex-wrap h-auto gap-1 mb-4">
                  {sections.map((section) => (
                    <TabsTrigger
                      key={section.id}
                      value={section.id}
                      className="text-sm"
                    >
                      {section.path}
                      <Badge
                        variant="secondary"
                        className="ml-1.5 text-[10px] px-1.5 py-0"
                      >
                        {section.lessons.length}
                      </Badge>
                    </TabsTrigger>
                  ))}
                </TabsList>

                {sections.map((section) => {
                  const sectionDuration = section.lessons.reduce(
                    (acc, lesson) =>
                      acc +
                      lesson.videos.reduce(
                        (videoAcc, video) =>
                          videoAcc +
                          video.clips.reduce(
                            (clipAcc, clip) =>
                              clipAcc +
                              (clip.sourceEndTime - clip.sourceStartTime),
                            0
                          ),
                        0
                      ),
                    0
                  );

                  return (
                    <TabsContent key={section.id} value={section.id}>
                      <div className="mb-3 flex items-center gap-3">
                        <h2 className="text-lg font-semibold">
                          {section.path}
                        </h2>
                        <Badge variant="secondary" className="text-xs">
                          {section.lessons.length} lessons &middot;{" "}
                          {formatSecondsToTimeCode(sectionDuration)}
                        </Badge>
                      </div>

                      <div className="space-y-1">
                        {section.lessons.map((lesson, li) => (
                          <React.Fragment key={lesson.id}>
                            <a id={lesson.id} />
                            {li > 0 && <Separator className="my-2" />}
                            <div className="rounded-md px-3 py-2">
                              <ContextMenu>
                                <ContextMenuTrigger asChild>
                                  <div className="flex items-center gap-2 mb-2 cursor-context-menu hover:bg-muted/50 rounded px-1.5 py-1 transition-colors">
                                    <BookOpen className="w-4 h-4 text-muted-foreground shrink-0" />
                                    <span className="text-base font-medium truncate">
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
                                  loaderData.hasExplainerFolderMap[lesson.id] ??
                                  false
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
                              <div className="ml-6 space-y-0.5">
                                {lesson.videos.map((video) => {
                                  const totalDuration = video.clips.reduce(
                                    (acc, clip) =>
                                      acc +
                                      (clip.sourceEndTime -
                                        clip.sourceStartTime),
                                    0
                                  );

                                  return (
                                    <ContextMenu key={video.id}>
                                      <ContextMenuTrigger asChild>
                                        <button
                                          className="flex items-center justify-between text-sm py-1.5 px-2.5 rounded hover:bg-muted/50 transition-colors cursor-context-menu w-full text-left"
                                          onMouseDown={(e) => {
                                            if (!isLeftClick(e)) return;
                                            navigate(
                                              `/videos/${video.id}/edit`
                                            );
                                          }}
                                        >
                                          <div className="flex items-center gap-2 min-w-0">
                                            <FileVideo
                                              className={cn(
                                                "w-3.5 h-3.5 shrink-0",
                                                loaderData.hasExportedVideoMap[
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
                    </TabsContent>
                  );
                })}
              </Tabs>
            </>
          ) : (
            <div className="max-w-4xl mx-auto">
              <h1 className="text-2xl font-bold mb-2">
                Course Video Manager (Tabbed)
              </h1>
              <p className="text-sm text-muted-foreground mb-8">
                Select a repository from the sidebar
              </p>
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
    </div>
  );
}
