import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ChevronDown,
  ChevronRight,
  GripVertical,
  Plus,
  Trash2,
} from "lucide-react";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type {
  Section,
  LessonPriority,
  LessonIcon,
} from "@/features/course-planner/types";
import type { planStateReducer } from "@/features/course-planner/plan-state-reducer";
import type { FlattenedLesson } from "./plans-planId-utils";
import { SortableLesson } from "./plans-planId-sortable-lesson";

export interface SortableSectionProps {
  section: Section;
  sectionNumber: number;
  state: planStateReducer.State;
  dispatch: (action: planStateReducer.Action) => void;
  allLessons: FlattenedLesson[];
  priorityFilter: LessonPriority[];
  pinnedLessonIds: string[];
  iconFilter: LessonIcon[];
  isCollapsed: boolean;
  onToggleCollapsed: () => void;
  dependencyMap: Record<string, string[]>;
}

export function SortableSection({
  section,
  sectionNumber,
  state,
  dispatch,
  allLessons,
  priorityFilter,
  pinnedLessonIds,
  iconFilter,
  isCollapsed,
  onToggleCollapsed,
  dependencyMap,
}: SortableSectionProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: section.id, data: { type: "section" } });

  // Derive editing state for this section
  const isEditing = state.editingSection?.sectionId === section.id;
  const editedTitle = isEditing ? state.editingSection!.value : "";
  const addingLesson = state.addingLesson?.sectionId === section.id;
  const newLessonTitle = addingLesson ? state.addingLesson!.value : "";

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const sortedLessons = [...section.lessons].sort((a, b) => a.order - b.order);

  // Filter lessons based on priority filter and icon filter
  // Priority filter: empty = show all, otherwise show only matching priorities
  // Also include pinned lessons (those whose priority was recently changed)
  // Icon filter: empty = show all, otherwise show only matching icons
  const filteredLessons = sortedLessons.filter((lesson) => {
    // Check priority filter (empty = show all, pinned lessons bypass filter)
    const passesPriorityFilter =
      priorityFilter.length === 0 ||
      priorityFilter.includes(lesson.priority ?? 2) ||
      pinnedLessonIds.includes(lesson.id);

    // Check icon filter (empty = show all)
    const passesIconFilter =
      iconFilter.length === 0 || iconFilter.includes(lesson.icon ?? "watch");

    return passesPriorityFilter && passesIconFilter;
  });

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="border rounded-lg p-4 group/section"
    >
      {/* Section Header */}
      <div className="flex items-center justify-between mb-3">
        {isEditing ? (
          <div className="flex items-center gap-2 flex-1">
            <Input
              value={editedTitle}
              onChange={(e) =>
                dispatch({
                  type: "section-title-changed",
                  value: e.target.value,
                })
              }
              className="font-semibold"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter")
                  dispatch({ type: "section-save-requested" });
                if (e.key === "Escape")
                  dispatch({ type: "section-cancel-requested" });
              }}
            />
            <Button
              size="sm"
              onClick={() => dispatch({ type: "section-save-requested" })}
            >
              Save
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => dispatch({ type: "section-cancel-requested" })}
            >
              Cancel
            </Button>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <button
                className="p-1 text-muted-foreground hover:text-foreground transition-colors"
                onClick={onToggleCollapsed}
              >
                {isCollapsed ? (
                  <ChevronRight className="w-4 h-4" />
                ) : (
                  <ChevronDown className="w-4 h-4" />
                )}
              </button>
              <button
                className="cursor-grab active:cursor-grabbing p-1"
                {...attributes}
                {...listeners}
              >
                <GripVertical className="w-5 h-5 text-muted-foreground" />
              </button>
              <h2
                className="font-semibold text-lg cursor-pointer hover:text-muted-foreground transition-colors"
                onClick={() =>
                  dispatch({
                    type: "section-title-clicked",
                    sectionId: section.id,
                  })
                }
              >
                <span className="text-muted-foreground mr-2">
                  {sectionNumber}.
                </span>
                {section.title}
              </h2>
              {/* Priority breakdown pills */}
              {(() => {
                const priorityCounts = { 1: 0, 2: 0, 3: 0 };
                for (const lesson of filteredLessons) {
                  if (lesson.status === "maybe") continue;
                  const p = lesson.priority ?? 2;
                  if (p === 1) priorityCounts[1]++;
                  else if (p === 2) priorityCounts[2]++;
                  else if (p === 3) priorityCounts[3]++;
                }
                return (
                  <div className="flex items-center gap-1">
                    {priorityCounts[1] > 0 && (
                      <span className="inline-flex items-center rounded-md bg-red-500/20 text-red-600 px-2 py-0.5 text-xs font-medium">
                        {priorityCounts[1]} P1
                      </span>
                    )}
                    {priorityCounts[2] > 0 && (
                      <span className="inline-flex items-center rounded-md bg-yellow-500/20 text-yellow-600 px-2 py-0.5 text-xs font-medium">
                        {priorityCounts[2]} P2
                      </span>
                    )}
                    {priorityCounts[3] > 0 && (
                      <span className="inline-flex items-center rounded-md bg-sky-500/20 text-sky-500 px-2 py-0.5 text-xs font-medium">
                        {priorityCounts[3]} P3
                      </span>
                    )}
                  </div>
                );
              })()}
              {isCollapsed && (
                <span className="text-xs text-muted-foreground">
                  {filteredLessons.length} lesson
                  {filteredLessons.length !== 1 ? "s" : ""}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1 opacity-0 group-hover/section:opacity-100 transition-opacity">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-destructive hover:text-destructive"
                onClick={() =>
                  dispatch({
                    type: "section-delete-clicked",
                    sectionId: section.id,
                  })
                }
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          </>
        )}
      </div>

      {/* Lessons */}
      {!isCollapsed && (
        <SortableContext
          items={filteredLessons.map((l) => l.id)}
          strategy={verticalListSortingStrategy}
        >
          <div className="space-y-1 ml-4">
            {filteredLessons.map((lesson) => {
              // Get the original index for consistent numbering
              const originalIndex = sortedLessons.findIndex(
                (l) => l.id === lesson.id
              );
              return (
                <SortableLesson
                  key={lesson.id}
                  lesson={lesson}
                  lessonNumber={`${sectionNumber}.${originalIndex + 1}`}
                  sectionId={section.id}
                  editingLesson={state.editingLesson}
                  editingDescription={state.editingDescription}
                  dispatch={dispatch}
                  allLessons={allLessons}
                  dependencyMap={dependencyMap}
                />
              );
            })}

            {/* Add Lesson */}
            {addingLesson ? (
              <div className="flex items-center gap-2 py-2 px-3">
                <Input
                  value={newLessonTitle}
                  onChange={(e) =>
                    dispatch({
                      type: "new-lesson-title-changed",
                      value: e.target.value,
                    })
                  }
                  placeholder="Lesson title..."
                  className="text-sm"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter")
                      dispatch({ type: "new-lesson-save-requested" });
                    if (e.key === "Escape")
                      dispatch({ type: "new-lesson-cancel-requested" });
                  }}
                />
                <Button
                  size="sm"
                  onClick={() =>
                    dispatch({ type: "new-lesson-save-requested" })
                  }
                >
                  Add
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    dispatch({ type: "new-lesson-cancel-requested" })
                  }
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <Button
                data-add-lesson-button={section.id}
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-muted-foreground"
                onClick={() =>
                  dispatch({
                    type: "add-lesson-clicked",
                    sectionId: section.id,
                  })
                }
              >
                <Plus className="w-4 h-4" />
              </Button>
            )}
          </div>
        </SortableContext>
      )}
    </div>
  );
}
