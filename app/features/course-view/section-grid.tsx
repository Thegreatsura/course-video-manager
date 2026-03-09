import { AddGhostLessonModal } from "@/components/add-ghost-lesson-modal";
import { DeleteSectionModal } from "@/components/delete-section-modal";
import { type DependencyLessonItem } from "@/components/dependency-selector";
import { EditGhostSectionModal } from "@/components/edit-ghost-section-modal";
import { EditSectionModal } from "@/components/edit-section-modal";
import { Badge } from "@/components/ui/badge";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { cn } from "@/lib/utils";
import { courseViewReducer } from "@/features/course-view/course-view-reducer";
import { SortableLessonItem } from "./sortable-lesson-item";
import { SortableSectionItem } from "./sortable-section-item";
import type { LoaderData, Section, Lesson } from "./course-view-types";
import { buildSectionTranscript } from "./section-transcript";
import { formatSecondsToTimeCode } from "@/services/utils";
import {
  DndContext,
  closestCenter,
  type DragEndEvent,
  type useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  rectSortingStrategy,
} from "@dnd-kit/sortable";
import {
  ClipboardCopy,
  Ghost,
  GripVertical,
  PencilIcon,
  Plus,
  Trash2,
} from "lucide-react";
import { useNavigate, useFetcher } from "react-router";
import { toast } from "sonner";

type Fetcher = ReturnType<typeof useFetcher>;

export function SectionGrid({
  currentRepo,
  data,
  sensors,
  handleSectionDragEnd,
  handleLessonDragEnd,
  reorderSectionFetcher,
  reorderLessonFetcher,
  deleteLessonFetcher,
  addGhostFetcher,
  createSectionFetcher,
  moveLessonFetcher,
  priorityFilter,
  iconFilter,
  fsStatusFilter,
  searchQuery,
  addGhostLessonSectionId,
  editSectionId,
  addVideoToLessonId,
  editLessonId,
  convertToGhostLessonId,
  deleteSectionId,
  dispatch,
  navigate,
  startExportUpload,
  revealVideoFetcher,
  deleteVideoFileFetcher,
  deleteVideoFetcher,
}: {
  currentRepo: NonNullable<LoaderData["selectedRepo"]>;
  data: LoaderData;
  sensors: ReturnType<typeof useSensors>;
  handleSectionDragEnd: (
    sections: {
      id: string;
      lessons: {
        id: string;
        title?: string | null;
        path: string;
        dependencies?: string[] | null;
      }[];
    }[],
    repoVersionId: string
  ) => (event: DragEndEvent) => void;
  handleLessonDragEnd: (
    sectionId: string,
    lessons: {
      id: string;
      title?: string | null;
      path: string;
      dependencies?: string[] | null;
    }[]
  ) => (event: DragEndEvent) => void;
  reorderSectionFetcher: Fetcher;
  reorderLessonFetcher: Fetcher;
  deleteLessonFetcher: Fetcher;
  addGhostFetcher: Fetcher;
  createSectionFetcher: Fetcher;
  moveLessonFetcher: Fetcher;
  priorityFilter: number[];
  iconFilter: string[];
  fsStatusFilter: string | null;
  searchQuery: string;
  addGhostLessonSectionId: string | null;
  editSectionId: string | null;
  addVideoToLessonId: string | null;
  editLessonId: string | null;
  convertToGhostLessonId: string | null;
  deleteSectionId: string | null;
  dispatch: (action: courseViewReducer.Action) => void;
  navigate: ReturnType<typeof useNavigate>;
  startExportUpload: (videoId: string, path: string) => void;
  revealVideoFetcher: Fetcher;
  deleteVideoFileFetcher: Fetcher;
  deleteVideoFetcher: Fetcher;
}) {
  // Optimistic section reordering
  let displaySections = currentRepo.sections;
  const pendingSectionReorder = reorderSectionFetcher.formData;
  if (pendingSectionReorder) {
    const sectionIds = JSON.parse(
      pendingSectionReorder.get("sectionIds") as string
    ) as string[];
    const sectionMap = new Map(currentRepo.sections.map((s) => [s.id, s]));
    const reordered = sectionIds
      .map((id) => sectionMap.get(id))
      .filter(Boolean) as typeof currentRepo.sections;
    if (reordered.length === currentRepo.sections.length) {
      displaySections = reordered;
    }
  }

  // Optimistic section creation
  const pendingSectionCreate = createSectionFetcher.formData;
  if (pendingSectionCreate) {
    const sectionTitle = pendingSectionCreate.get("title") as string;
    displaySections = [
      ...displaySections,
      {
        id: `optimistic-section-${sectionTitle}`,
        path: sectionTitle,
        order: displaySections.length,
        lessons: [],
        repoVersionId: data.selectedVersion!.id,
        createdAt: new Date(),
        previousVersionSectionId: null,
      } as Section,
    ];
  }

  // Build flat lessons list for dependency selector
  const allFlatLessons: DependencyLessonItem[] = displaySections.flatMap(
    (section, sectionIdx) =>
      section.lessons.map((lesson, lessonIdx) => ({
        id: lesson.id,
        number: `${sectionIdx + 1}.${lessonIdx + 1}`,
        title:
          lesson.fsStatus === "ghost"
            ? lesson.title || lesson.path
            : lesson.path,
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
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
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
              const lessonMap = new Map(section.lessons.map((l) => [l.id, l]));
              const reordered = lessonIds
                .map((id) => lessonMap.get(id))
                .filter(Boolean) as typeof section.lessons;
              if (reordered.length === section.lessons.length) {
                lessons = reordered;
              }
            }

            // Optimistic lesson deletion
            const pendingDelete = deleteLessonFetcher.formData;
            const pendingDeleteId = pendingDelete?.get("lessonId") as
              | string
              | null;
            if (pendingDeleteId) {
              lessons = lessons.filter((l) => l.id !== pendingDeleteId);
            }

            // Optimistic ghost lesson addition
            const pendingGhostAdd = addGhostFetcher.formData;
            if (
              pendingGhostAdd &&
              pendingGhostAdd.get("sectionId") === section.id
            ) {
              const ghostTitle = pendingGhostAdd.get("title") as string;
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

            // Optimistic lesson move between sections
            const pendingMove = moveLessonFetcher.formData;
            if (pendingMove) {
              const movedLessonId = pendingMove.get("lessonId") as string;
              const targetSectionId = pendingMove.get("sectionId") as string;
              // Remove from source section
              if (targetSectionId !== section.id) {
                lessons = lessons.filter((l) => l.id !== movedLessonId);
              }
              // Add to target section
              if (targetSectionId === section.id) {
                const movedLesson = displaySections
                  .flatMap((s) => s.lessons)
                  .find((l) => l.id === movedLessonId);
                if (
                  movedLesson &&
                  !lessons.some((l) => l.id === movedLessonId)
                ) {
                  lessons = [
                    ...lessons,
                    { ...movedLesson, sectionId: section.id },
                  ];
                }
              }
            }

            // Filter lessons based on active filters
            const hasActiveFilters =
              priorityFilter.length > 0 ||
              iconFilter.length > 0 ||
              fsStatusFilter !== null ||
              searchQuery.length > 0;
            const filteredLessons = hasActiveFilters
              ? lessons.filter((lesson) => {
                  const passesPriorityFilter =
                    priorityFilter.length === 0 ||
                    priorityFilter.includes(lesson.priority ?? 2);
                  const passesIconFilter =
                    iconFilter.length === 0 ||
                    iconFilter.includes(lesson.icon ?? "watch");
                  const passesFsStatusFilter = (() => {
                    if (fsStatusFilter === null) return true;
                    if (fsStatusFilter === "ghost")
                      return (lesson.fsStatus ?? "real") === "ghost";
                    if (fsStatusFilter === "real")
                      return (lesson.fsStatus ?? "real") === "real";
                    // "todo" filter
                    if ((lesson.fsStatus ?? "real") !== "real") return false;
                    if (lesson.videos.length === 0) return true;
                    if (lesson.videos.every((v) => v.clips.length > 1))
                      return false;
                    return lesson.videos.some((v) => v.clips.length === 0);
                  })();
                  const passesSearch = (() => {
                    if (!searchQuery) return true;
                    const q = searchQuery.toLowerCase();
                    if (lesson.path.toLowerCase().includes(q)) return true;
                    if (lesson.title?.toLowerCase().includes(q)) return true;
                    if (lesson.description?.toLowerCase().includes(q))
                      return true;
                    return lesson.videos.some((v) =>
                      v.path.toLowerCase().includes(q)
                    );
                  })();
                  return (
                    passesPriorityFilter &&
                    passesIconFilter &&
                    passesFsStatusFilter &&
                    passesSearch
                  );
                })
              : lessons;

            const sectionDuration = lessons.reduce((acc, lesson) => {
              return (
                acc +
                lesson.videos.reduce((videoAcc, video) => {
                  return (
                    videoAcc +
                    video.clips.reduce((clipAcc, clip) => {
                      return (
                        clipAcc + (clip.sourceEndTime - clip.sourceStartTime)
                      );
                    }, 0)
                  );
                }, 0)
              );
            }, 0);

            const isGhostSection =
              lessons.length === 0 ||
              lessons.every((l) => l.fsStatus === "ghost");

            return (
              <SortableSectionItem key={section.id} id={section.id}>
                {(dragHandleListeners) => (
                  <>
                    <ContextMenu>
                      <ContextMenuTrigger asChild>
                        <div className="cursor-context-menu">
                          <div className="px-4 py-3 border-b bg-muted/30">
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
                              {!isGhostSection && (
                                <Badge
                                  variant="secondary"
                                  className="text-[10px]"
                                >
                                  {formatSecondsToTimeCode(sectionDuration)}
                                </Badge>
                              )}
                            </div>
                          </div>
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
                                    addVideoToLessonId={addVideoToLessonId}
                                    editLessonId={editLessonId}
                                    convertToGhostLessonId={
                                      convertToGhostLessonId
                                    }
                                    dispatch={dispatch}
                                    startExportUpload={startExportUpload}
                                    revealVideoFetcher={revealVideoFetcher}
                                    deleteVideoFileFetcher={
                                      deleteVideoFileFetcher
                                    }
                                    deleteVideoFetcher={deleteVideoFetcher}
                                    deleteLessonFetcher={deleteLessonFetcher}
                                    dependencyMap={dependencyMap}
                                  />
                                ))}
                              </SortableContext>
                            </DndContext>
                          </div>
                        </div>
                      </ContextMenuTrigger>
                      <ContextMenuContent>
                        <ContextMenuItem
                          onSelect={() =>
                            dispatch({
                              type: "set-add-ghost-lesson-section-id",
                              sectionId: section.id,
                            })
                          }
                        >
                          <Plus className="w-4 h-4" />
                          Add Lesson
                        </ContextMenuItem>
                        <ContextMenuItem
                          onSelect={() =>
                            dispatch({
                              type: "set-edit-section-id",
                              sectionId: section.id,
                            })
                          }
                        >
                          <PencilIcon className="w-4 h-4" />
                          Rename
                        </ContextMenuItem>
                        {lessons.some(
                          (l) => l.fsStatus !== "ghost" && l.videos.length > 0
                        ) && (
                          <ContextMenuItem
                            onSelect={async () => {
                              try {
                                await navigator.clipboard.writeText(
                                  buildSectionTranscript(section.path, lessons)
                                );
                                toast("Section transcript copied to clipboard");
                              } catch {
                                toast.error(
                                  "Failed to copy transcript to clipboard"
                                );
                              }
                            }}
                          >
                            <ClipboardCopy className="w-4 h-4" />
                            Copy Section Transcript
                          </ContextMenuItem>
                        )}
                        {isGhostSection && (
                          <>
                            <ContextMenuSeparator />
                            <ContextMenuItem
                              className="text-destructive focus:text-destructive"
                              onSelect={() =>
                                dispatch({
                                  type: "set-delete-section-id",
                                  sectionId: section.id,
                                })
                              }
                            >
                              <Trash2 className="w-4 h-4" />
                              Delete Section
                            </ContextMenuItem>
                          </>
                        )}
                      </ContextMenuContent>
                    </ContextMenu>
                    <AddGhostLessonModal
                      sectionId={section.id}
                      open={addGhostLessonSectionId === section.id}
                      onOpenChange={(open) => {
                        dispatch({
                          type: "set-add-ghost-lesson-section-id",
                          sectionId: open ? section.id : null,
                        });
                      }}
                      fetcher={addGhostFetcher}
                    />
                    <DeleteSectionModal
                      sectionId={section.id}
                      sectionTitle={section.path}
                      lessonCount={lessons.length}
                      open={deleteSectionId === section.id}
                      onOpenChange={(open) => {
                        dispatch({
                          type: "set-delete-section-id",
                          sectionId: open ? section.id : null,
                        });
                      }}
                    />
                    {isGhostSection ? (
                      <EditGhostSectionModal
                        sectionId={section.id}
                        currentTitle={section.path}
                        open={editSectionId === section.id}
                        onOpenChange={(open) => {
                          dispatch({
                            type: "set-edit-section-id",
                            sectionId: open ? section.id : null,
                          });
                        }}
                      />
                    ) : (
                      <EditSectionModal
                        sectionId={section.id}
                        currentPath={section.path}
                        open={editSectionId === section.id}
                        onOpenChange={(open) => {
                          dispatch({
                            type: "set-edit-section-id",
                            sectionId: open ? section.id : null,
                          });
                        }}
                      />
                    )}
                  </>
                )}
              </SortableSectionItem>
            );
          })}
        </div>
      </SortableContext>
    </DndContext>
  );
}
