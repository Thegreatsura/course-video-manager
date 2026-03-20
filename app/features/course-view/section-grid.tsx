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
import {
  applyOptimisticLessonUpdates,
  filterLessons,
  calcSectionDuration,
} from "./section-grid-utils";
import type { LoaderData, Section } from "./course-view-types";

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
  ChevronRight,
  ClipboardCopy,
  Ghost,
  GripVertical,
  PencilIcon,
  Plus,
  Trash2,
} from "lucide-react";
import { useState, useCallback } from "react";
import { useNavigate, useFetcher } from "react-router";

type Fetcher = ReturnType<typeof useFetcher>;

export function SectionGrid({
  currentCourse,
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
  insertAdjacentLessonId,
  insertPosition,
  editSectionId,
  addVideoToLessonId,
  editLessonId,
  convertToGhostLessonId,
  deleteLessonId,
  deleteSectionId,
  dispatch,
  navigate,
  startExportUpload,
  revealVideoFetcher,
  deleteVideoFileFetcher,
  deleteVideoFetcher,
}: {
  currentCourse: NonNullable<LoaderData["selectedCourse"]>;
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
  insertAdjacentLessonId: string | null;
  insertPosition: "before" | "after" | null;
  editSectionId: string | null;
  addVideoToLessonId: string | null;
  editLessonId: string | null;
  convertToGhostLessonId: string | null;
  deleteLessonId: string | null;
  deleteSectionId: string | null;
  dispatch: (action: courseViewReducer.Action) => void;
  navigate: ReturnType<typeof useNavigate>;
  startExportUpload: (videoId: string, path: string) => void;
  revealVideoFetcher: Fetcher;
  deleteVideoFileFetcher: Fetcher;
  deleteVideoFetcher: Fetcher;
}) {
  const deleteSectionFetcher = useFetcher();
  const COLLAPSED_SECTIONS_KEY = "collapsed-sections";

  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(
    () => {
      if (typeof localStorage === "undefined") return new Set();
      try {
        const stored = localStorage.getItem(COLLAPSED_SECTIONS_KEY);
        if (stored) return new Set(JSON.parse(stored) as string[]);
      } catch {}
      return new Set();
    }
  );

  const toggleSection = useCallback((sectionId: string) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(sectionId)) {
        next.delete(sectionId);
      } else {
        next.add(sectionId);
      }
      if (typeof localStorage !== "undefined") {
        try {
          localStorage.setItem(
            COLLAPSED_SECTIONS_KEY,
            JSON.stringify([...next])
          );
        } catch {}
      }
      return next;
    });
  }, []);

  // Optimistic section reordering
  let displaySections = currentCourse.sections;
  const pendingSectionReorder = reorderSectionFetcher.formData;
  if (pendingSectionReorder) {
    const sectionIds = JSON.parse(
      pendingSectionReorder.get("sectionIds") as string
    ) as string[];
    const sectionMap = new Map(currentCourse.sections.map((s) => [s.id, s]));
    const reordered = sectionIds
      .map((id) => sectionMap.get(id))
      .filter(Boolean) as typeof currentCourse.sections;
    if (reordered.length === currentCourse.sections.length) {
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

  const isReadOnly = !data.isLatestVersion;

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
            const lessons = applyOptimisticLessonUpdates(
              section,
              displaySections,
              {
                reorderFormData: reorderLessonFetcher.formData,
                deleteFormData: deleteLessonFetcher.formData,
                addFormData: addGhostFetcher.formData,
                addFormAction: addGhostFetcher.formAction,
                moveFormData: moveLessonFetcher.formData,
              }
            );

            const { filteredLessons, hasActiveFilters } = filterLessons(
              lessons,
              { priorityFilter, iconFilter, fsStatusFilter, searchQuery }
            );

            const sectionDuration = calcSectionDuration(lessons);

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
                                {!isReadOnly && (
                                  <button
                                    className="cursor-grab active:cursor-grabbing text-muted-foreground/50 hover:text-muted-foreground touch-none"
                                    {...dragHandleListeners}
                                  >
                                    <GripVertical className="w-4 h-4" />
                                  </button>
                                )}
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
                              <div className="flex items-center gap-1.5">
                                {!isGhostSection && (
                                  <Badge
                                    variant="secondary"
                                    className="text-[10px]"
                                  >
                                    {formatSecondsToTimeCode(sectionDuration)}
                                  </Badge>
                                )}
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    toggleSection(section.id);
                                  }}
                                  className="text-muted-foreground/50 hover:text-muted-foreground transition-colors p-0.5"
                                >
                                  <ChevronRight
                                    className={cn(
                                      "w-4 h-4 transition-transform",
                                      (!collapsedSections.has(section.id) ||
                                        searchQuery) &&
                                        "rotate-90"
                                    )}
                                  />
                                </button>
                              </div>
                            </div>
                          </div>
                          {(!collapsedSections.has(section.id) ||
                            searchQuery) && (
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
                                      deleteLessonId={deleteLessonId}
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
                          )}
                        </div>
                      </ContextMenuTrigger>
                      <ContextMenuContent>
                        {!isReadOnly && (
                          <>
                            <ContextMenuItem
                              onSelect={() =>
                                dispatch({
                                  type: "set-add-lesson-section-id",
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
                          </>
                        )}
                        {lessons.length > 0 && (
                          <ContextMenuItem
                            onSelect={() =>
                              dispatch({
                                type: "open-copy-section-transcript",
                                sectionPath: section.path,
                                lessons,
                              })
                            }
                          >
                            <ClipboardCopy className="w-4 h-4" />
                            Copy Section Transcript
                          </ContextMenuItem>
                        )}
                        {!isReadOnly && isGhostSection && (
                          <>
                            <ContextMenuSeparator />
                            <ContextMenuItem
                              className="text-destructive focus:text-destructive"
                              onSelect={() => {
                                if (lessons.length === 0) {
                                  deleteSectionFetcher.submit(null, {
                                    method: "post",
                                    action: `/api/sections/${section.id}/delete`,
                                  });
                                } else {
                                  dispatch({
                                    type: "set-delete-section-id",
                                    sectionId: section.id,
                                  });
                                }
                              }}
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
                          type: "set-add-lesson-section-id",
                          sectionId: open ? section.id : null,
                        });
                      }}
                      fetcher={addGhostFetcher}
                      adjacentLessonId={insertAdjacentLessonId}
                      position={insertPosition}
                      courseFilePath={currentCourse.filePath}
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
