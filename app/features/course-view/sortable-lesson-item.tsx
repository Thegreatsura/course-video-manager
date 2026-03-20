import { AddVideoModal } from "@/components/add-video-modal";
import { ConvertToGhostModal } from "@/components/convert-to-ghost-modal";
import { CreateOnDiskModal } from "./create-on-disk-modal";
import { DeleteLessonModal } from "@/components/delete-lesson-modal";
import {
  DependencySelector,
  type DependencyLessonItem,
} from "@/components/dependency-selector";
import { EditGhostLessonModal } from "@/components/edit-ghost-lesson-modal";
import { EditLessonModal } from "@/components/edit-lesson-modal";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { courseViewReducer } from "@/features/course-view/course-view-reducer";
import { VideoThumbnailGrid } from "./video-thumbnail-grid";
import type { LoaderData, Section, Lesson } from "./course-view-types";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowRightLeft,
  BookOpen,
  Code,
  Ghost,
  GripVertical,
  MessageCircle,
  PencilIcon,
  Play,
  Plus,
  Trash2,
} from "lucide-react";

import { use, useCallback, useRef, useState } from "react";
import { useNavigate, useFetcher } from "react-router";

export function SortableLessonItem({
  lesson,
  lessonIndex,
  section,
  data,
  navigate,
  addVideoToLessonId,
  editLessonId,
  convertToGhostLessonId,
  deleteLessonId,
  dispatch,
  startExportUpload,
  revealVideoFetcher,
  deleteVideoFileFetcher,
  deleteVideoFetcher,
  deleteLessonFetcher,
  allFlatLessons,
  dependencyMap,
  hideAnchor,
}: {
  lesson: Lesson;
  lessonIndex: number;
  section: Section;
  data: LoaderData;
  navigate: ReturnType<typeof useNavigate>;
  addVideoToLessonId: string | null;
  editLessonId: string | null;
  convertToGhostLessonId: string | null;
  deleteLessonId: string | null;
  dispatch: (action: courseViewReducer.Action) => void;
  startExportUpload: (videoId: string, path: string) => void;
  revealVideoFetcher: ReturnType<typeof useFetcher>;
  deleteVideoFileFetcher: ReturnType<typeof useFetcher>;
  deleteVideoFetcher: ReturnType<typeof useFetcher>;
  deleteLessonFetcher: ReturnType<typeof useFetcher>;
  allFlatLessons: DependencyLessonItem[];
  dependencyMap: Record<string, string[]>;
  hideAnchor?: boolean;
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

  const lessonFsMaps = use(data.lessonFsMaps);
  const isReadOnly = !data.isLatestVersion;
  const createOnDiskFetcher = useFetcher();
  const isGhost =
    lesson.fsStatus === "ghost" && createOnDiskFetcher.state === "idle";
  const isGhostCourse = !data.selectedCourse?.filePath;
  const [showCreateOnDiskModal, setShowCreateOnDiskModal] = useState(false);

  const descriptionFetcher = useFetcher();
  const currentDescription =
    (descriptionFetcher.formData?.get("description") as string) ??
    lesson.description ??
    "";
  const [editingDesc, setEditingDesc] = useState(false);
  const [descValue, setDescValue] = useState(lesson.description || "");
  const descTextareaRef = useRef<HTMLTextAreaElement>(null);
  const dependencyFetcher = useFetcher();
  const iconFetcher = useFetcher();
  const priorityFetcher = useFetcher();

  const currentIcon = ((iconFetcher.formData?.get("icon") as string) ??
    lesson.icon ??
    "watch") as "watch" | "code" | "discussion";
  const currentPriority = (
    priorityFetcher.formData
      ? Number(priorityFetcher.formData.get("priority"))
      : (lesson.priority ?? 2)
  ) as 1 | 2 | 3;

  const handleIconCycle = useCallback(() => {
    const nextIcon =
      currentIcon === "watch"
        ? "code"
        : currentIcon === "code"
          ? "discussion"
          : "watch";
    iconFetcher.submit(
      { icon: nextIcon },
      {
        method: "post",
        action: `/api/lessons/${lesson.id}/update-icon`,
      }
    );
  }, [currentIcon, lesson.id, iconFetcher]);

  const handlePriorityCycle = useCallback(() => {
    const nextPriority =
      currentPriority === 2 ? 3 : currentPriority === 3 ? 1 : 2;
    priorityFetcher.submit(
      { priority: String(nextPriority) },
      {
        method: "post",
        action: `/api/lessons/${lesson.id}/update-priority`,
      }
    );
  }, [currentPriority, lesson.id, priorityFetcher]);

  // Dependency violation checking (optimistic: read pending fetcher data first)
  const lessonDeps = dependencyFetcher.formData
    ? (JSON.parse(
        dependencyFetcher.formData.get("dependencies") as string
      ) as string[])
    : (lesson.dependencies ?? []);
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
      const depLesson = data.selectedCourse?.sections
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
      if (value !== currentDescription) {
        descriptionFetcher.submit(
          { description: value },
          {
            method: "post",
            action: `/api/lessons/${lesson.id}/update-description`,
          }
        );
      }
    },
    [currentDescription, lesson.id, descriptionFetcher]
  );

  return (
    <div ref={setNodeRef} style={style}>
      {!hideAnchor && <a id={lesson.id} />}
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
              {!isReadOnly && (
                <button
                  className="cursor-grab active:cursor-grabbing p-0.5 -ml-1 touch-none flex items-center justify-center"
                  {...attributes}
                  {...listeners}
                >
                  <GripVertical className="w-3.5 h-3.5 text-muted-foreground" />
                </button>
              )}
              <button
                className={cn(
                  "flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center transition-colors",
                  currentIcon === "code"
                    ? "bg-yellow-500/20 text-yellow-600"
                    : currentIcon === "discussion"
                      ? "bg-green-500/20 text-green-600"
                      : "bg-purple-500/20 text-purple-600"
                )}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!isReadOnly) handleIconCycle();
                }}
                title={
                  currentIcon === "code"
                    ? isReadOnly
                      ? "Interactive"
                      : "Interactive (click to change)"
                    : currentIcon === "discussion"
                      ? isReadOnly
                        ? "Discussion"
                        : "Discussion (click to change)"
                      : isReadOnly
                        ? "Watch"
                        : "Watch (click to change)"
                }
              >
                {currentIcon === "code" ? (
                  <Code className="w-3 h-3" />
                ) : currentIcon === "discussion" ? (
                  <MessageCircle className="w-3 h-3" />
                ) : (
                  <Play className="w-3 h-3" />
                )}
              </button>
              <span
                className={cn(
                  "text-sm font-medium",
                  isGhost && "text-muted-foreground/70 italic"
                )}
              >
                {isGhost ? lesson.title || lesson.path : lesson.path}
              </span>
              {isGhost && (
                <span className="flex items-center text-muted-foreground/60 shrink-0">
                  <Ghost className="w-3 h-3" />
                </span>
              )}
              <button
                className={cn(
                  "flex-shrink-0 text-xs px-2 py-0.5 rounded-sm font-medium",
                  currentPriority === 1
                    ? "bg-red-500/20 text-red-600"
                    : currentPriority === 3
                      ? "bg-sky-500/20 text-sky-500"
                      : "bg-yellow-500/20 text-yellow-600"
                )}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!isReadOnly) handlePriorityCycle();
                }}
                title={
                  isReadOnly
                    ? `P${currentPriority}`
                    : "Click to toggle priority (P2 → P3 → P1 → P2)"
                }
              >
                P{currentPriority}
              </button>
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
            {!isReadOnly && (
              <>
                {isGhost ? (
                  <>
                    <ContextMenuItem
                      onSelect={() => {
                        if (isGhostCourse) {
                          // Delay so the Dialog opens after the ContextMenu
                          // has fully closed — otherwise Radix's dismiss
                          // events immediately close the Dialog.
                          requestAnimationFrame(() =>
                            setShowCreateOnDiskModal(true)
                          );
                        } else {
                          createOnDiskFetcher.submit(null, {
                            method: "post",
                            action: `/api/lessons/${lesson.id}/create-on-disk`,
                          });
                        }
                      }}
                    >
                      <BookOpen className="w-4 h-4" />
                      Create on Disk
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem
                      onSelect={() =>
                        dispatch({
                          type: "set-edit-lesson-id",
                          lessonId: lesson.id,
                        })
                      }
                    >
                      <PencilIcon className="w-4 h-4" />
                      Rename
                    </ContextMenuItem>
                  </>
                ) : (
                  <>
                    <ContextMenuItem
                      onSelect={() =>
                        dispatch({
                          type: "set-add-video-to-lesson-id",
                          lessonId: lesson.id,
                        })
                      }
                    >
                      <Plus className="w-4 h-4" />
                      Add Video
                    </ContextMenuItem>
                    <ContextMenuItem
                      onSelect={() =>
                        dispatch({
                          type: "set-edit-lesson-id",
                          lessonId: lesson.id,
                        })
                      }
                    >
                      <PencilIcon className="w-4 h-4" />
                      Rename
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem
                      onSelect={() =>
                        dispatch({
                          type: "set-convert-to-ghost-lesson-id",
                          lessonId: lesson.id,
                        })
                      }
                    >
                      <Ghost className="w-4 h-4" />
                      Convert to Ghost
                    </ContextMenuItem>
                  </>
                )}
                <ContextMenuSeparator />
                <ContextMenuItem
                  onSelect={() =>
                    dispatch({
                      type: "set-insert-lesson",
                      sectionId: section.id,
                      adjacentLessonId: lesson.id,
                      position: "before",
                    })
                  }
                >
                  <Plus className="w-4 h-4" />
                  Add Lesson Before
                </ContextMenuItem>
                <ContextMenuItem
                  onSelect={() =>
                    dispatch({
                      type: "set-insert-lesson",
                      sectionId: section.id,
                      adjacentLessonId: lesson.id,
                      position: "after",
                    })
                  }
                >
                  <Plus className="w-4 h-4" />
                  Add Lesson After
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem
                  onSelect={() =>
                    dispatch({
                      type: "open-move-lesson",
                      lessonId: lesson.id,
                      lessonTitle: isGhost
                        ? lesson.title || lesson.path
                        : lesson.path,
                      currentSectionId: section.id,
                    })
                  }
                >
                  <ArrowRightLeft className="w-4 h-4" />
                  Move to Section
                </ContextMenuItem>
                <ContextMenuItem
                  variant="destructive"
                  onSelect={() => {
                    if (isGhost) {
                      deleteLessonFetcher.submit(
                        { lessonId: lesson.id },
                        {
                          method: "post",
                          action: "/api/lessons/delete",
                        }
                      );
                    } else {
                      dispatch({
                        type: "set-delete-lesson-id",
                        lessonId: lesson.id,
                      });
                    }
                  }}
                >
                  <Trash2 className="w-4 h-4" />
                  Delete
                </ContextMenuItem>
              </>
            )}
          </ContextMenuContent>
        </ContextMenu>
        <div className="ml-5">
          {!isReadOnly && editingDesc ? (
            <div className="mt-1 max-w-[65ch]">
              <Textarea
                ref={descTextareaRef}
                value={descValue}
                onChange={(e) => setDescValue(e.target.value)}
                placeholder="What should this lesson teach?"
                className="text-sm min-h-[60px]"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setDescValue(currentDescription);
                    setEditingDesc(false);
                  }
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                    saveDescription(descValue);
                  }
                }}
                onBlur={() => saveDescription(descValue)}
              />
            </div>
          ) : currentDescription ? (
            <div
              className={cn(
                "text-xs text-muted-foreground mt-1 whitespace-pre-line max-w-[65ch]",
                !isReadOnly && "cursor-pointer hover:text-foreground/70"
              )}
              onClick={() => {
                if (isReadOnly) return;
                setDescValue(currentDescription);
                setEditingDesc(true);
              }}
            >
              {currentDescription}
            </div>
          ) : !isReadOnly ? (
            <button
              className="text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors"
              onClick={() => {
                setDescValue("");
                setEditingDesc(true);
              }}
            >
              + Add description
            </button>
          ) : null}
        </div>
        <AddVideoModal
          lessonId={lesson.id}
          videoCount={lesson.videos.length}
          hasExplainerFolder={
            lessonFsMaps.hasExplainerFolderMap[lesson.id] ?? false
          }
          open={addVideoToLessonId === lesson.id}
          onOpenChange={(open) => {
            dispatch({
              type: "set-add-video-to-lesson-id",
              lessonId: open ? lesson.id : null,
            });
          }}
        />
        {isGhost ? (
          <EditGhostLessonModal
            lessonId={lesson.id}
            currentTitle={lesson.title || lesson.path}
            open={editLessonId === lesson.id}
            onOpenChange={(open) => {
              dispatch({
                type: "set-edit-lesson-id",
                lessonId: open ? lesson.id : null,
              });
            }}
          />
        ) : (
          <EditLessonModal
            lessonId={lesson.id}
            currentPath={lesson.path}
            open={editLessonId === lesson.id}
            onOpenChange={(open) => {
              dispatch({
                type: "set-edit-lesson-id",
                lessonId: open ? lesson.id : null,
              });
            }}
          />
        )}
        {!isGhost && (
          <DeleteLessonModal
            lessonId={lesson.id}
            lessonTitle={lesson.path}
            filesOnDisk={lessonFsMaps.lessonHasFilesMap[lesson.id] ?? []}
            open={deleteLessonId === lesson.id}
            onOpenChange={(open) => {
              dispatch({
                type: "set-delete-lesson-id",
                lessonId: open ? lesson.id : null,
              });
            }}
          />
        )}
        {!isGhost && (
          <ConvertToGhostModal
            lessonId={lesson.id}
            lessonTitle={lesson.path}
            filesOnDisk={lessonFsMaps.lessonHasFilesMap[lesson.id] ?? []}
            hasVideos={lesson.videos.length > 0}
            open={convertToGhostLessonId === lesson.id}
            onOpenChange={(open) => {
              dispatch({
                type: "set-convert-to-ghost-lesson-id",
                lessonId: open ? lesson.id : null,
              });
            }}
          />
        )}
        <div className="ml-5 mt-3">
          <VideoThumbnailGrid
            videos={lesson.videos}
            section={section}
            lesson={lesson}
            data={data}
            navigate={navigate}
            dispatch={dispatch}
            startExportUpload={startExportUpload}
            revealVideoFetcher={revealVideoFetcher}
            deleteVideoFileFetcher={deleteVideoFileFetcher}
            deleteVideoFetcher={deleteVideoFetcher}
          />
        </div>
        <CreateOnDiskModal
          lessonId={lesson.id}
          open={showCreateOnDiskModal}
          onOpenChange={setShowCreateOnDiskModal}
        />
      </div>
    </div>
  );
}
