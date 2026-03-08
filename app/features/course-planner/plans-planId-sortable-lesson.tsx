import { Button } from "@/components/ui/button";
import { DependencySelector } from "@/components/dependency-selector";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Check,
  CircleHelp,
  Code,
  GripVertical,
  MessageCircle,
  Play,
  Square,
  Trash2,
} from "lucide-react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Lesson } from "@/features/course-planner/types";
import type { planStateReducer } from "@/features/course-planner/plan-state-reducer";
import type { FlattenedLesson } from "./plans-planId-utils";
import {
  checkDependencyViolation,
  checkPriorityViolation,
} from "./plans-planId-utils";

export interface SortableLessonProps {
  lesson: Lesson;
  lessonNumber: string;
  sectionId: string;
  editingLesson: planStateReducer.State["editingLesson"];
  editingDescription: planStateReducer.State["editingDescription"];
  dispatch: (action: planStateReducer.Action) => void;
  allLessons: FlattenedLesson[];
  dependencyMap: Record<string, string[]>;
}

export function SortableLesson({
  lesson,
  lessonNumber,
  sectionId,
  editingLesson,
  editingDescription,
  dispatch,
  allLessons,
  dependencyMap,
}: SortableLessonProps) {
  const isEditingTitle = editingLesson?.lessonId === lesson.id;
  const editedTitle = isEditingTitle ? editingLesson.value : "";
  const isEditingDesc = editingDescription?.lessonId === lesson.id;
  const editedDesc = isEditingDesc ? editingDescription.value : "";
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

  const orderViolations = checkDependencyViolation(lesson, allLessons);
  const priorityViolations = checkPriorityViolation(lesson, allLessons);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`py-2 px-3 rounded hover:bg-muted/50 group ${lesson.status === "maybe" ? "opacity-50" : ""}`}
    >
      <div className="flex items-start gap-3">
        {/* Grip handle */}
        <button
          className="cursor-grab active:cursor-grabbing p-1 mt-0.5"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="w-4 h-4 text-muted-foreground" />
        </button>

        {/* Circle badge icon */}
        <button
          className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center ${
            lesson.icon === "code"
              ? "bg-yellow-500/20 text-yellow-600"
              : lesson.icon === "discussion"
                ? "bg-green-500/20 text-green-600"
                : "bg-purple-500/20 text-purple-600"
          }`}
          onClick={() => {
            const nextIcon =
              lesson.icon === "watch" || lesson.icon === undefined
                ? "code"
                : lesson.icon === "code"
                  ? "discussion"
                  : "watch";
            dispatch({
              type: "lesson-icon-changed",
              sectionId,
              lessonId: lesson.id,
              icon: nextIcon,
            });
          }}
          title={
            lesson.icon === "code"
              ? "Interactive (click to change)"
              : lesson.icon === "discussion"
                ? "Discussion (click to change)"
                : "Watch (click to change)"
          }
        >
          {lesson.icon === "code" ? (
            <Code className="w-3.5 h-3.5" />
          ) : lesson.icon === "discussion" ? (
            <MessageCircle className="w-3.5 h-3.5" />
          ) : (
            <Play className="w-3.5 h-3.5" />
          )}
        </button>

        {/* Content - title and description */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between">
            {isEditingTitle ? (
              <div className="flex items-center gap-2 flex-1">
                <Input
                  value={editedTitle}
                  onChange={(e) =>
                    dispatch({
                      type: "lesson-title-changed",
                      value: e.target.value,
                    })
                  }
                  className="text-sm"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter")
                      dispatch({ type: "lesson-save-requested" });
                    if (e.key === "Escape")
                      dispatch({ type: "lesson-cancel-requested" });
                  }}
                />
                <Button
                  size="sm"
                  onClick={() => dispatch({ type: "lesson-save-requested" })}
                >
                  Save
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => dispatch({ type: "lesson-cancel-requested" })}
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <div
                    className="flex items-center gap-2 cursor-pointer hover:text-muted-foreground transition-colors"
                    onClick={() =>
                      dispatch({
                        type: "lesson-title-clicked",
                        lessonId: lesson.id,
                        sectionId,
                      })
                    }
                  >
                    <span className="text-sm text-muted-foreground">
                      {lessonNumber}
                    </span>
                    <span className="text-sm">{lesson.title}</span>
                  </div>
                  {/* Dependency selector */}
                  <DependencySelector
                    lessonId={lesson.id}
                    dependencies={lesson.dependencies ?? []}
                    allLessons={allLessons}
                    onDependenciesChange={(newDeps) =>
                      dispatch({
                        type: "lesson-dependencies-changed",
                        sectionId,
                        lessonId: lesson.id,
                        dependencies: newDeps,
                      })
                    }
                    orderViolations={orderViolations}
                    priorityViolations={priorityViolations}
                    lessonPriority={lesson.priority ?? 2}
                    dependencyMap={dependencyMap}
                  />
                  {/* Priority pill */}
                  <button
                    className={`flex-shrink-0 text-xs px-2 py-0.5 rounded-sm font-medium ${
                      lesson.priority === 1
                        ? "bg-red-500/20 text-red-600"
                        : lesson.priority === 3
                          ? "bg-sky-500/20 text-sky-500"
                          : "bg-yellow-500/20 text-yellow-600"
                    }`}
                    onClick={() =>
                      dispatch({
                        type: "lesson-priority-toggled",
                        sectionId,
                        lessonId: lesson.id,
                      })
                    }
                    title="Click to toggle priority (P2 → P3 → P1 → P2)"
                  >
                    P{lesson.priority ?? 2}
                  </button>
                  {/* Status pill */}
                  <button
                    className={`flex-shrink-0 text-xs px-2 py-0.5 rounded-sm font-medium flex items-center gap-1 ${
                      lesson.status === "done"
                        ? "bg-foreground text-background"
                        : "bg-muted text-muted-foreground"
                    }`}
                    onClick={() =>
                      dispatch({
                        type: "lesson-status-toggled",
                        sectionId,
                        lessonId: lesson.id,
                      })
                    }
                    title="Click to toggle status"
                  >
                    {lesson.status === "done" ? (
                      <>
                        <Check className="w-3 h-3" />
                        DONE
                      </>
                    ) : lesson.status === "maybe" ? (
                      <>
                        <CircleHelp className="w-3 h-3" />
                        MAYBE
                      </>
                    ) : (
                      <>
                        <Square className="w-3 h-3" />
                        TODO
                      </>
                    )}
                  </button>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-destructive hover:text-destructive"
                    onClick={() =>
                      dispatch({
                        type: "lesson-delete-clicked",
                        sectionId,
                        lessonId: lesson.id,
                      })
                    }
                  >
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              </>
            )}
          </div>
          {/* Description */}
          {isEditingDesc ? (
            <div className="mt-1">
              <Textarea
                value={editedDesc}
                onChange={(e) =>
                  dispatch({
                    type: "lesson-description-changed",
                    value: e.target.value,
                  })
                }
                placeholder="Add a description..."
                className="text-sm min-h-[80px]"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Escape")
                    dispatch({ type: "lesson-description-cancel-requested" });
                  if (
                    (e.key === " " && e.ctrlKey) ||
                    (e.key === "Enter" && (e.ctrlKey || e.metaKey))
                  ) {
                    e.preventDefault();
                    dispatch({ type: "lesson-description-save-requested" });
                  }
                }}
              />
              <div className="flex gap-2 mt-2">
                <Button
                  size="sm"
                  onClick={() =>
                    dispatch({ type: "lesson-description-save-requested" })
                  }
                >
                  Save
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    dispatch({ type: "lesson-description-cancel-requested" })
                  }
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : lesson.description ? (
            <div
              className="mt-1 text-xs text-muted-foreground cursor-pointer hover:text-foreground max-w-[65ch] whitespace-pre-line"
              onClick={() =>
                dispatch({
                  type: "lesson-description-clicked",
                  lessonId: lesson.id,
                  sectionId,
                })
              }
            >
              {lesson.description}
            </div>
          ) : (
            <button
              className="mt-1 text-xs text-muted-foreground/50 hover:text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={() =>
                dispatch({
                  type: "lesson-description-clicked",
                  lessonId: lesson.id,
                  sectionId,
                })
              }
            >
              + Add description
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
