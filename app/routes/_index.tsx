"use client";

import { AppSidebar } from "@/components/app-sidebar";
import { CreateSectionModal } from "@/components/create-section-modal";
import { VideoModal } from "@/components/video-player";
import {
  useCourseEditor,
  editorSectionsToLoaderSections,
} from "@/hooks/use-course-editor";
import { useFocusRevalidate } from "@/hooks/use-focus-revalidate";
import type { courseViewReducer } from "@/features/course-view/course-view-reducer";
import { Button } from "@/components/ui/button";
import { DBFunctionsService } from "@/services/db-service.server";
import {
  loadExportStatusMap,
  loadLessonFsMaps,
  toSlimVideo,
} from "@/services/course-loader-fs";
import type { ExportClip } from "@/services/export-hash";
import { FeatureFlagService } from "@/services/feature-flag-service";
import { runtimeLive } from "@/services/layer.server";
import {
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { Console, Effect } from "effect";
import { getGitStatusAsync } from "@/services/git-status-service";
import { Loader2, Plus } from "lucide-react";
import { Suspense, useContext, useMemo, useState } from "react";
import { data, useFetcher, useNavigate, useSearchParams } from "react-router";
import type { Route } from "./+types/_index";
import { UploadContext } from "@/features/upload-manager/upload-context";
import { ActionsDropdown } from "@/features/course-view/actions-menu";
import { SectionGrid } from "@/features/course-view/section-grid";
import {
  FilterBar,
  StatsBar,
  NoCourseView,
  ReadOnlyBanner,
  RouteModals,
} from "@/features/course-view/course-view-components";
import { NextTodoCard } from "@/features/course-view/next-todo-card";
import {
  createLessonDragHandler,
  createSectionDragHandler,
  computeFsStatusCounts,
  computeFlatLessons,
  computeDependencyMap,
} from "@/features/course-view/course-editor-helpers";

export const meta: Route.MetaFunction = ({ data }) => {
  const selectedCourse = data?.selectedCourse;

  if (selectedCourse) {
    return [
      {
        title: `CVM - ${selectedCourse.name}`,
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
  const selectedCourseId = url.searchParams.get("courseId");
  const selectedVersionId = url.searchParams.get("versionId");

  return Effect.gen(function* () {
    const db = yield* DBFunctionsService;
    const featureFlags = yield* FeatureFlagService;

    const courses = yield* db.getCourses();
    const standaloneVideos = yield* db.getStandaloneVideosSidebar();
    const plans = yield* db.getPlans();

    let versions: Awaited<
      ReturnType<typeof db.getCourseVersions>
    > extends Effect.Effect<infer R, any, any>
      ? R
      : never = [];
    let selectedVersion: Awaited<
      ReturnType<typeof db.getLatestCourseVersion>
    > extends Effect.Effect<infer R, any, any>
      ? R
      : never = undefined;

    if (selectedCourseId) {
      versions = yield* db.getCourseVersions(selectedCourseId);

      // If versionId provided, use it; otherwise use latest
      if (selectedVersionId) {
        selectedVersion = yield* db
          .getCourseVersionById(selectedVersionId)
          .pipe(
            Effect.catchTag("NotFoundError", () => Effect.succeed(undefined))
          );
      } else {
        selectedVersion = yield* db.getLatestCourseVersion(selectedCourseId);
      }
    }

    const selectedCourse = yield* !selectedCourseId
      ? Effect.succeed(undefined)
      : db
          .getCourseWithSlimClipsById(selectedCourseId, selectedVersion?.id)
          .pipe(
            Effect.andThen((course) => {
              if (!course) {
                return undefined;
              }

              const allSections = course.versions[0]?.sections ?? [];

              return {
                ...course,
                sections: allSections.filter((section) => {
                  return !section.path.endsWith("ARCHIVE");
                }),
              };
            })
          );

    // Build slim video summaries for the UI (no clip arrays sent to client)
    const allVideos = selectedCourse?.sections.flatMap((s) =>
      s.lessons.flatMap((l) => l.videos)
    );

    const slimCourse = selectedCourse
      ? (() => {
          const { versions, sections, ...courseRest } = selectedCourse;
          return {
            ...courseRest,
            sections: sections.map((section) => {
              const { lessons, ...sectionRest } = section;
              return {
                ...sectionRest,
                lessons: lessons.map((lesson) => {
                  const { videos, ...lessonRest } = lesson;
                  return {
                    ...lessonRest,
                    videos: videos.map(toSlimVideo),
                  };
                }),
              };
            }),
          };
        })()
      : undefined;

    const lessons = selectedCourse?.filePath
      ? selectedCourse.sections.flatMap((section) =>
          section.lessons
            .filter((lesson) => lesson.fsStatus !== "ghost")
            .map((lesson) => ({
              id: lesson.id,
              fullPath: `${selectedCourse.filePath}/${section.path}/${lesson.path}`,
            }))
        )
      : [];

    // Deferred: streams to the client after initial render
    const hasExportedVideoMap = selectedCourse
      ? runtimeLive.runPromise(
          loadExportStatusMap({
            courseId: selectedCourse.id,
            videos: (allVideos ?? []).map((v) => ({
              id: v.id,
              clips: v.clips as ExportClip[],
            })),
          })
        )
      : Promise.resolve({} as Record<string, boolean>);

    const lessonFsMaps = runtimeLive.runPromise(loadLessonFsMaps({ lessons }));

    // Deferred: transcript text per video, loaded via separate DB query
    const videoTranscripts = selectedCourseId
      ? runtimeLive.runPromise(db.getVideoTranscripts(selectedCourseId))
      : Promise.resolve({} as Record<string, string>);

    const latestVersion = versions[0];
    const isLatestVersion = !!(
      selectedVersion &&
      latestVersion &&
      selectedVersion.id === latestVersion.id
    );

    const gitStatus = selectedCourse?.filePath
      ? getGitStatusAsync(selectedCourse.filePath)
      : Promise.resolve(null);

    return {
      courses,
      standaloneVideos,
      selectedCourse: slimCourse,
      versions,
      selectedVersion,
      isLatestVersion,
      hasExportedVideoMap,
      lessonFsMaps,
      videoTranscripts,
      plans,
      gitStatus,
      showMediaFilesList: featureFlags.isEnabled("ENABLE_MEDIA_FILES_LIST"),
      showPlansSection: featureFlags.isEnabled("ENABLE_PLANS_SECTION"),
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
  const selectedCourseId = searchParams.get("courseId");

  // Key on courseId so React remounts the inner component (and resets
  // reducer state) whenever the user switches courses — same pattern
  // the video editor uses with key={video.id}.
  return <ComponentInner {...props} key={selectedCourseId ?? "no-course"} />;
}

function ComponentInner(props: Route.ComponentProps) {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const selectedCourseId = searchParams.get("courseId");
  const loaderData = props.loaderData;
  const courses = loaderData.courses;
  const currentCourse = loaderData.selectedCourse;

  // Course editor reducer owns entity state + UI state
  const {
    state: viewState,
    dispatch,
    pendingCount,
  } = useCourseEditor(currentCourse?.sections ?? [], {
    courseFilePath: currentCourse?.filePath,
  });

  // Adapter: convert reducer-owned sections back to loader Section[] shape
  // for existing components that haven't been migrated yet
  const displaySections = useMemo(
    () => editorSectionsToLoaderSections(viewState.sections),
    [viewState.sections]
  );

  // Build a course object with reducer-owned sections for existing components
  const courseWithEditorSections = useMemo(
    () =>
      currentCourse
        ? { ...currentCourse, sections: displaySections }
        : undefined,
    [currentCourse, displaySections]
  );

  // Cast dispatch for backward compatibility with components that expect
  // courseViewReducer.Action. Safe because action shapes are structurally
  // identical at runtime — only the branded ID types differ nominally.
  const legacyDispatch = dispatch as unknown as (
    action: courseViewReducer.Action
  ) => void;

  // Wrap viewState for RouteModals which expects courseViewReducer.State
  const legacyViewState = viewState as unknown as courseViewReducer.State;

  const {
    isAddCourseModalOpen,
    isCreateSectionModalOpen,
    isAddStandaloneVideoModalOpen,
    addGhostLessonSectionId,
    insertAdjacentLessonId,
    insertPosition,
    addVideoToLessonId,
    editSectionId,
    convertToGhostLessonId,
    deleteLessonId,
    createOnDiskLessonId,
    archiveSectionId,
    videoPlayerState,
    priorityFilter,
    iconFilter,
    fsStatusFilter,
    searchQuery,
  } = viewState;

  const [nextUpDismissed, setNextUpDismissed] = useState(false);
  const { uploads, startExportUpload, startBatchExportUpload } =
    useContext(UploadContext);

  const hasActiveUploads = Object.values(uploads).some(
    (u) =>
      u.status === "uploading" ||
      u.status === "waiting" ||
      u.status === "retrying"
  );

  useFocusRevalidate({ enabled: !!selectedCourseId, intervalMs: 5000 });

  // Fetchers still needed for video operations and non-entity mutations
  const deleteVideoFetcher = useFetcher();
  const deleteVideoFileFetcher = useFetcher();
  const revealVideoFetcher = useFetcher();
  const archiveCourseFetcher = useFetcher();
  const gitPushFetcher = useFetcher();

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleLessonDragEnd = useMemo(
    () => createLessonDragHandler(dispatch),
    [dispatch]
  );

  const handleSectionDragEnd = useMemo(
    () => createSectionDragHandler(dispatch),
    [dispatch]
  );

  const allFlatLessons = useMemo(
    () => computeFlatLessons(displaySections),
    [displaySections]
  );

  const dependencyMap = useMemo(
    () => computeDependencyMap(displaySections),
    [displaySections]
  );

  const fsStatusCounts = useMemo(
    () =>
      computeFsStatusCounts(displaySections, {
        priorityFilter,
        iconFilter,
        searchQuery,
      }),
    [displaySections, priorityFilter, iconFilter, searchQuery]
  );

  const handleBatchExport = () => {
    if (!loaderData.selectedVersion) return;
    startBatchExportUpload(loaderData.selectedVersion.id);
  };

  return (
    <div className="flex h-screen bg-background text-foreground">
      <AppSidebar
        courses={courses}
        standaloneVideos={loaderData.standaloneVideos}
        selectedCourseId={selectedCourseId}
        isAddCourseModalOpen={isAddCourseModalOpen}
        setIsAddCourseModalOpen={(open) =>
          dispatch({ type: "set-add-course-modal-open", open })
        }
        isAddStandaloneVideoModalOpen={isAddStandaloneVideoModalOpen}
        setIsAddStandaloneVideoModalOpen={(open) =>
          dispatch({ type: "set-add-standalone-video-modal-open", open })
        }
        plans={loaderData.plans}
        showPlansSection={loaderData.showPlansSection}
      />

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-6">
          {courseWithEditorSections ? (
            <>
              {/* Title + version + actions */}
              <div className="flex items-center gap-2 mb-2">
                <h1 className="text-2xl font-bold flex items-center gap-2">
                  {courseWithEditorSections.name}
                  {loaderData.selectedVersion &&
                    loaderData.versions.length > 1 && (
                      <button
                        onClick={() =>
                          dispatch({
                            type: "set-version-selector-modal-open",
                            open: true,
                          })
                        }
                        className="text-muted-foreground hover:text-foreground transition-colors text-lg font-normal"
                      >
                        [{loaderData.selectedVersion.name || "Draft"}]
                      </button>
                    )}
                </h1>
                <ActionsDropdown
                  currentCourse={courseWithEditorSections}
                  data={loaderData}
                  dispatch={legacyDispatch}
                  archiveCourseFetcher={archiveCourseFetcher}
                  gitPushFetcher={gitPushFetcher}
                  handleBatchExport={handleBatchExport}
                />
              </div>

              {loaderData.selectedVersion && !loaderData.isLatestVersion && (
                <ReadOnlyBanner />
              )}

              <div className="mb-10">
                <StatsBar
                  selectedCourse={loaderData.selectedCourse}
                  gitStatus={loaderData.gitStatus}
                />
              </div>

              <Suspense>
                {loaderData.isLatestVersion && (
                  <div className="mb-14">
                    <NextTodoCard
                      sections={displaySections}
                      data={loaderData}
                      navigate={navigate}
                      addVideoToLessonId={addVideoToLessonId as string | null}
                      convertToGhostLessonId={
                        convertToGhostLessonId as string | null
                      }
                      deleteLessonId={deleteLessonId as string | null}
                      createOnDiskLessonId={
                        createOnDiskLessonId as string | null
                      }
                      dispatch={legacyDispatch}
                      startExportUpload={startExportUpload}
                      revealVideoFetcher={revealVideoFetcher}
                      deleteVideoFileFetcher={deleteVideoFileFetcher}
                      deleteVideoFetcher={deleteVideoFetcher}
                      allFlatLessons={allFlatLessons}
                      dependencyMap={dependencyMap}
                      dismissed={nextUpDismissed}
                      onDismiss={() => setNextUpDismissed(true)}
                    />
                  </div>
                )}

                <div className="mb-4">
                  <h2 className="text-lg font-semibold mb-3">All Lessons</h2>
                  <FilterBar
                    priorityFilter={priorityFilter}
                    iconFilter={iconFilter}
                    fsStatusFilter={fsStatusFilter}
                    fsStatusCounts={fsStatusCounts}
                    searchQuery={searchQuery}
                    dispatch={legacyDispatch}
                    isRealCourse={courseWithEditorSections?.filePath != null}
                  />
                </div>

                <SectionGrid
                  currentCourse={courseWithEditorSections}
                  data={loaderData}
                  isGhostCourse={!viewState.courseFilePath}
                  sensors={sensors}
                  handleSectionDragEnd={handleSectionDragEnd}
                  handleLessonDragEnd={handleLessonDragEnd}
                  priorityFilter={priorityFilter}
                  iconFilter={iconFilter}
                  fsStatusFilter={fsStatusFilter}
                  searchQuery={searchQuery}
                  addGhostLessonSectionId={
                    addGhostLessonSectionId as string | null
                  }
                  insertAdjacentLessonId={
                    insertAdjacentLessonId as string | null
                  }
                  insertPosition={insertPosition}
                  editSectionId={editSectionId as string | null}
                  addVideoToLessonId={addVideoToLessonId as string | null}
                  convertToGhostLessonId={
                    convertToGhostLessonId as string | null
                  }
                  deleteLessonId={deleteLessonId as string | null}
                  createOnDiskLessonId={createOnDiskLessonId as string | null}
                  archiveSectionId={archiveSectionId as string | null}
                  dispatch={legacyDispatch}
                  navigate={navigate}
                  startExportUpload={startExportUpload}
                  revealVideoFetcher={revealVideoFetcher}
                  deleteVideoFileFetcher={deleteVideoFileFetcher}
                  deleteVideoFetcher={deleteVideoFetcher}
                />

                {loaderData.selectedVersion && loaderData.isLatestVersion && (
                  <div className="mt-8 flex justify-center">
                    <Button
                      variant="outline"
                      className="border-dashed"
                      onClick={() =>
                        dispatch({
                          type: "set-create-section-modal-open",
                          open: true,
                        })
                      }
                    >
                      <Plus className="w-4 h-4" />
                      Add Section
                    </Button>
                  </div>
                )}
              </Suspense>

              {loaderData.selectedVersion && loaderData.isLatestVersion && (
                <CreateSectionModal
                  repoVersionId={loaderData.selectedVersion.id}
                  maxOrder={displaySections.length}
                  open={isCreateSectionModalOpen}
                  onOpenChange={(open) =>
                    dispatch({ type: "set-create-section-modal-open", open })
                  }
                  onCreateSection={(title) => {
                    dispatch({
                      type: "add-section",
                      title,
                      repoVersionId: loaderData.selectedVersion!.id,
                    });
                  }}
                />
              )}
            </>
          ) : (
            <NoCourseView
              courses={courses}
              standaloneVideos={loaderData.standaloneVideos}
              dispatch={legacyDispatch}
              navigate={navigate}
            />
          )}
        </div>
      </div>

      {pendingCount > 0 && (
        <div
          className={`fixed right-4 z-40 flex items-center gap-2 bg-background border rounded-full px-3 py-1.5 shadow-lg text-sm text-muted-foreground transition-all ${hasActiveUploads ? "bottom-[6.5rem]" : "bottom-16"}`}
          aria-label={`${pendingCount} action${pendingCount === 1 ? "" : "s"} queued`}
        >
          <Loader2 className="size-3.5 animate-spin shrink-0" />
          <span>
            {pendingCount} {pendingCount === 1 ? "action" : "actions"} saving
          </span>
        </div>
      )}

      <VideoModal
        videoId={videoPlayerState.videoId}
        videoPath={videoPlayerState.videoPath}
        isOpen={videoPlayerState.isOpen}
        onClose={() => {
          dispatch({ type: "close-video-player" });
        }}
      />

      <RouteModals
        currentCourse={courseWithEditorSections}
        data={loaderData}
        selectedCourseId={selectedCourseId}
        viewState={legacyViewState}
        dispatch={legacyDispatch}
        navigate={navigate}
      />
    </div>
  );
}
