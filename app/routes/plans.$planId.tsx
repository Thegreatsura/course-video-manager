import { AppSidebar } from "@/components/app-sidebar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DependencySelector } from "@/components/dependency-selector";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { usePlanReducer } from "@/hooks/use-plan-reducer";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  ClipboardCopy,
  Code,
  Copy,
  GripVertical,
  MessageCircle,
  MoreVertical,
  Play,
  Plus,
  RefreshCw,
  Square,
  Trash2,
} from "lucide-react";
import { useState, useCallback } from "react";
import { Link, useNavigate, data } from "react-router";
import type {
  LessonPriority,
  LessonIcon,
} from "@/features/course-planner/types";
import type { planStateReducer } from "@/features/course-planner/plan-state-reducer";
import type { Route } from "./+types/plans.$planId";
import { Console, Effect } from "effect";
import { DBFunctionsService } from "@/services/db-service.server";
import { runtimeLive } from "@/services/layer.server";
import {
  DndContext,
  closestCenter,
  pointerWithin,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
  type CollisionDetection,
  DragOverlay,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Section, Lesson, Plan } from "@/features/course-planner/types";
import { NotFoundError } from "@/services/db-service-errors";

export const loader = async ({ params }: Route.LoaderArgs) => {
  return Effect.gen(function* () {
    const db = yield* DBFunctionsService;
    const [repos, standaloneVideos, plans] = yield* Effect.all([
      db.getRepos(),
      db.getStandaloneVideos(),
      db.getPlans(),
    ]);
    const plan = plans.find((p) => p.id === params.planId);

    if (!plan) {
      return yield* new NotFoundError({
        params,
        type: "plan",
        message: `Plan with id ${params.planId} not found`,
      });
    }
    return { plan, plans, repos, standaloneVideos };
  }).pipe(
    Effect.tapErrorCause((e) => Console.dir(e, { depth: null })),
    Effect.catchTag("NotFoundError", (e) => {
      return Effect.die(data(e.message, { status: 404 }));
    }),
    Effect.catchAll(() => {
      return Effect.die(data("Internal server error", { status: 500 }));
    }),
    runtimeLive.runPromise
  );
};

// Custom collision detection that prioritizes lessons over sections
// This allows dropping on a specific lesson position even when crossing sections
const customCollisionDetection: CollisionDetection = (args) => {
  // First check for pointer within collisions (items the pointer is inside)
  const pointerCollisions = pointerWithin(args);

  // If we have pointer collisions, prioritize lessons over sections
  if (pointerCollisions.length > 0) {
    // Check if any collision is with a lesson (not a section)
    // Sections have data.type === 'section', lessons don't
    const lessonCollision = pointerCollisions.find((collision) => {
      const container = args.droppableContainers.find(
        (c) => c.id === collision.id
      );
      return container?.data.current?.type !== "section";
    });
    if (lessonCollision) {
      return [lessonCollision];
    }
    return pointerCollisions;
  }

  // Fall back to closest center if no pointer collisions
  return closestCenter(args);
};

export const meta: Route.MetaFunction = () => {
  return [{ title: "Plan - CVM" }];
};

// Generate markdown from plan (respects active filters)
interface PlanToMarkdownOptions {
  priorityFilter: LessonPriority[];
  iconFilter: LessonIcon[];
  pinnedLessonIds: string[];
}

function planToMarkdown(plan: Plan, options: PlanToMarkdownOptions): string {
  const { priorityFilter, iconFilter, pinnedLessonIds } = options;

  // Filter function matching the display logic
  const passesFilters = (lesson: Lesson) => {
    // Check priority filter (empty = show all, pinned lessons bypass filter)
    const passesPriorityFilter =
      priorityFilter.length === 0 ||
      priorityFilter.includes(lesson.priority ?? 2) ||
      pinnedLessonIds.includes(lesson.id);

    // Check icon filter (empty = show all)
    const passesIconFilter =
      iconFilter.length === 0 || iconFilter.includes(lesson.icon ?? "watch");

    return passesPriorityFilter && passesIconFilter;
  };

  const lines: string[] = [];
  lines.push(`# ${plan.title}`);
  lines.push("");

  const sortedSections = [...plan.sections].sort((a, b) => a.order - b.order);

  let sectionNumber = 0;
  for (const section of sortedSections) {
    const sortedLessons = [...section.lessons].sort(
      (a, b) => a.order - b.order
    );
    const filteredLessons = sortedLessons.filter(passesFilters);

    // Skip sections with no visible lessons
    if (filteredLessons.length === 0) continue;

    sectionNumber++;
    lines.push(`## ${sectionNumber}. ${section.title}`);
    lines.push("");

    let lessonIndex = 0;
    for (const lesson of filteredLessons) {
      lessonIndex++;
      const lessonNumber = `${sectionNumber}.${lessonIndex}`;

      // Determine lesson type label
      let typeLabel: string;
      if (lesson.icon === "code") {
        typeLabel = "Interactive";
      } else if (lesson.icon === "discussion") {
        typeLabel = "Discussion";
      } else {
        typeLabel = "Explainer";
      }

      const priority = lesson.priority ?? 2;
      lines.push(
        `### ${lessonNumber} ${lesson.title} (${typeLabel}, P${priority})`
      );

      if (lesson.description) {
        lines.push("");
        lines.push(lesson.description);
      }

      lines.push("");
    }
  }

  return lines.join("\n");
}

// Flattened lesson with extra info for dependency selection
interface FlattenedLesson {
  id: string;
  number: string;
  title: string;
  sectionId: string;
  sectionTitle: string;
  sectionNumber: number;
  priority: LessonPriority;
}

// Helper to check if dependency order is violated
function checkDependencyViolation(
  lesson: Lesson,
  allFlattenedLessons: FlattenedLesson[]
): FlattenedLesson[] {
  const violations: FlattenedLesson[] = [];
  const lessonIndex = allFlattenedLessons.findIndex((l) => l.id === lesson.id);

  for (const depId of lesson.dependencies || []) {
    const depIndex = allFlattenedLessons.findIndex((l) => l.id === depId);
    if (depIndex > lessonIndex) {
      const depLesson = allFlattenedLessons[depIndex];
      if (depLesson) {
        violations.push(depLesson);
      }
    }
  }

  return violations;
}

// Helper to check if dependency priority is violated
// P1 lessons can only depend on P1 lessons
// P2 lessons can depend on P1 or P2 lessons
// P3 lessons can depend on any lesson
function checkPriorityViolation(
  lesson: { priority?: LessonPriority; dependencies?: string[] },
  allFlattenedLessons: FlattenedLesson[]
): FlattenedLesson[] {
  const violations: FlattenedLesson[] = [];
  const lessonPriority = lesson.priority ?? 2;

  for (const depId of lesson.dependencies || []) {
    const depLesson = allFlattenedLessons.find((l) => l.id === depId);
    if (depLesson) {
      const depPriority = depLesson.priority;
      // A lesson can only depend on lessons with equal or higher priority (lower number)
      if (depPriority > lessonPriority) {
        violations.push(depLesson);
      }
    }
  }

  return violations;
}

// Sortable Lesson Component
interface SortableLessonProps {
  lesson: Lesson;
  lessonNumber: string;
  sectionId: string;
  editingLesson: planStateReducer.State["editingLesson"];
  editingDescription: planStateReducer.State["editingDescription"];
  dispatch: (action: planStateReducer.Action) => void;
  allLessons: FlattenedLesson[];
}

function SortableLesson({
  lesson,
  lessonNumber,
  sectionId,
  editingLesson,
  editingDescription,
  dispatch,
  allLessons,
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
                  />
                  {/* Priority pill */}
                  <button
                    className={`flex-shrink-0 text-xs px-2 py-0.5 rounded-sm font-medium ${
                      lesson.priority === 1
                        ? "bg-red-500/20 text-red-600"
                        : lesson.priority === 3
                          ? "bg-gray-500/20 text-gray-500"
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
                  if (e.key === " " && e.ctrlKey) {
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

// Sortable Section Component
interface SortableSectionProps {
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
}

function SortableSection({
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
                      <span className="inline-flex items-center rounded-md bg-gray-500/20 text-gray-500 px-2 py-0.5 text-xs font-medium">
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

export default function PlanDetailPage(props: Route.ComponentProps) {
  // Key on plan ID to force recreation when navigating between plans
  // This ensures the reducer reinitializes with the new plan's data
  return <PlanDetailPageContent key={props.loaderData.plan?.id} {...props} />;
}

function PlanDetailPageContent({ loaderData }: Route.ComponentProps) {
  const navigate = useNavigate();
  const { state, dispatch, duplicatePlan } = usePlanReducer({
    initialPlan: loaderData.plan!,
  });

  const { plan, syncError } = state;

  // Drag and drop state (stays separate from reducer - managed by dnd-kit)
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeDragType, setActiveDragType] = useState<
    "section" | "lesson" | null
  >(null);

  // Collapsed sections state, persisted in localStorage per plan
  const [collapsedSectionIds, setCollapsedSectionIds] = useState<Set<string>>(
    () => {
      if (typeof window === "undefined") return new Set();
      try {
        const stored = localStorage.getItem(
          `plan-collapsed-sections:${loaderData.plan!.id}`
        );
        return stored ? new Set(JSON.parse(stored)) : new Set();
      } catch {
        return new Set();
      }
    }
  );

  const toggleSectionCollapsed = useCallback(
    (sectionId: string) => {
      setCollapsedSectionIds((prev) => {
        const next = new Set(prev);
        if (next.has(sectionId)) {
          next.delete(sectionId);
        } else {
          next.add(sectionId);
        }
        localStorage.setItem(
          `plan-collapsed-sections:${loaderData.plan!.id}`,
          JSON.stringify([...next])
        );
        return next;
      });
    },
    [loaderData.plan!.id]
  );

  // Priority filter comes from the reducer (allows pinning behavior)
  const { priorityFilter, pinnedLessonIds, iconFilter } = state;

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  if (!plan) {
    return (
      <div className="flex h-screen bg-background text-foreground">
        <AppSidebar
          repos={loaderData.repos}
          standaloneVideos={loaderData.standaloneVideos}
          plans={loaderData.plans}
        />
        <div className="flex-1 p-6">
          <div className="text-center py-12">
            <h1 className="text-2xl font-bold mb-4">Plan not found</h1>
            <Link
              to="/"
              onClick={(e) => e.preventDefault()}
              onMouseDown={(e) => {
                if (e.button === 0) navigate("/");
              }}
            >
              <Button variant="outline">
                <ChevronLeft className="w-4 h-4 mr-2" />
                Back to Home
              </Button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const sortedSections = [...plan.sections].sort((a, b) => a.order - b.order);

  // Create flattened lessons array for dependency selection
  const allFlattenedLessons: FlattenedLesson[] = sortedSections.flatMap(
    (section, sectionIndex) => {
      const sortedLessons = [...section.lessons].sort(
        (a, b) => a.order - b.order
      );
      return sortedLessons.map((lesson, lessonIndex) => ({
        id: lesson.id,
        number: `${sectionIndex + 1}.${lessonIndex + 1}`,
        title: lesson.title,
        sectionId: section.id,
        sectionTitle: section.title,
        sectionNumber: sectionIndex + 1,
        priority: lesson.priority ?? 2,
      }));
    }
  );

  // Helper to check if a lesson passes the current filters
  const passesFilters = (lesson: Lesson) => {
    // Skip "maybe" lessons from stats
    if (lesson.status === "maybe") return false;
    // Check priority filter (empty = show all)
    const lessonPriority = lesson.priority ?? 2;
    if (priorityFilter.length > 0 && !priorityFilter.includes(lessonPriority))
      return false;
    // Check icon filter (empty = show all)
    if (iconFilter.length > 0) {
      const lessonIcon = lesson.icon ?? "watch";
      if (!iconFilter.includes(lessonIcon)) return false;
    }
    return true;
  };

  // Stats per icon type (filtered by current filters)
  const iconStats = plan.sections.reduce(
    (acc, section) => {
      for (const lesson of section.lessons) {
        if (!passesFilters(lesson)) continue;
        const icon = lesson.icon || "watch";
        acc[icon].total++;
        if (lesson.status === "done") {
          acc[icon].done++;
        }
      }
      return acc;
    },
    {
      code: { total: 0, done: 0 },
      discussion: { total: 0, done: 0 },
      watch: { total: 0, done: 0 },
    }
  );

  const getPercentage = (stats: { total: number; done: number }) =>
    stats.total > 0 ? Math.round((stats.done / stats.total) * 100) : 0;

  // Filtered stats (respecting current filters)
  const totalLessons = plan.sections.reduce(
    (acc, section) => acc + section.lessons.filter(passesFilters).length,
    0
  );
  // Estimated videos: play/watch = 1, code = 2, discussion = 1 (filtered)
  const estimatedVideos = plan.sections.reduce(
    (acc, section) =>
      acc +
      section.lessons.filter(passesFilters).reduce((lessonAcc, lesson) => {
        if (lesson.icon === "code") return lessonAcc + 2;
        return lessonAcc + 1; // watch and discussion = 1
      }, 0),
    0
  );

  // Find which section a lesson belongs to
  const findSectionForLesson = (lessonId: string): Section | undefined => {
    return plan.sections.find((section) =>
      section.lessons.some((lesson) => lesson.id === lessonId)
    );
  };

  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event;
    const activeIdStr = active.id as string;
    setActiveId(activeIdStr);

    // Determine if we're dragging a section or a lesson
    const isSection = plan.sections.some((s) => s.id === activeIdStr);
    setActiveDragType(isSection ? "section" : "lesson");
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);
    setActiveDragType(null);

    if (!over) return;

    const activeIdStr = active.id as string;
    const overIdStr = over.id as string;

    if (activeIdStr === overIdStr) return;

    // Handle section reordering
    if (activeDragType === "section") {
      const newIndex = sortedSections.findIndex((s) => s.id === overIdStr);
      if (newIndex !== -1) {
        dispatch({
          type: "section-reordered",
          sectionId: activeIdStr,
          newIndex,
        });
      }
      return;
    }

    // Handle lesson reordering
    if (activeDragType === "lesson") {
      const fromSection = findSectionForLesson(activeIdStr);
      if (!fromSection) return;

      // Check if dropping on a section (empty or header)
      const toSection = plan.sections.find((s) => s.id === overIdStr);
      if (toSection) {
        // Moving to end of another section
        const sortedLessons = [...toSection.lessons].sort(
          (a, b) => a.order - b.order
        );
        dispatch({
          type: "lesson-reordered",
          fromSectionId: fromSection.id,
          toSectionId: toSection.id,
          lessonId: activeIdStr,
          newIndex: sortedLessons.length,
        });
        return;
      }

      // Check if dropping on a lesson
      const overSection = findSectionForLesson(overIdStr);
      if (overSection) {
        const sortedLessons = [...overSection.lessons].sort(
          (a, b) => a.order - b.order
        );
        const overIndex = sortedLessons.findIndex((l) => l.id === overIdStr);
        dispatch({
          type: "lesson-reordered",
          fromSectionId: fromSection.id,
          toSectionId: overSection.id,
          lessonId: activeIdStr,
          newIndex: overIndex,
        });
      }
    }
  };

  // Get active item for overlay
  const activeSection =
    activeDragType === "section"
      ? plan.sections.find((s) => s.id === activeId)
      : null;
  const activeLesson =
    activeDragType === "lesson"
      ? plan.sections.flatMap((s) => s.lessons).find((l) => l.id === activeId)
      : null;

  return (
    <div className="flex h-screen bg-background text-foreground">
      <AppSidebar
        repos={loaderData.repos}
        standaloneVideos={loaderData.standaloneVideos}
        plans={loaderData.plans}
      />
      <div className="flex-1 overflow-y-auto">
        {/* Sync Error Banner */}
        {syncError && (
          <div className="bg-destructive/15 border-b border-destructive/30 px-6 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-destructive">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>
                Failed to save changes: {syncError}. Your changes may not be
                persisted.
              </span>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => dispatch({ type: "sync-retry-requested" })}
              className="shrink-0 gap-1.5"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Retry
            </Button>
          </div>
        )}

        <div className="p-6 max-w-4xl">
          {/* Header */}
          <div className="mb-6">
            <Link
              to="/"
              className="text-sm text-muted-foreground hover:text-foreground mb-4 inline-flex items-center"
            >
              <ChevronLeft className="w-4 h-4 mr-1" />
              Back
            </Link>

            <div className="flex items-center gap-2 mt-2 group/title">
              {state.editingTitle.active ? (
                <div className="flex items-center gap-2">
                  <Input
                    value={state.editingTitle.value}
                    onChange={(e) =>
                      dispatch({
                        type: "plan-title-changed",
                        value: e.target.value,
                      })
                    }
                    className="text-2xl font-bold h-auto py-1"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter")
                        dispatch({ type: "plan-title-save-requested" });
                      if (e.key === "Escape")
                        dispatch({ type: "plan-title-cancel-requested" });
                    }}
                  />
                  <Button
                    size="sm"
                    onClick={() =>
                      dispatch({ type: "plan-title-save-requested" })
                    }
                  >
                    Save
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      dispatch({ type: "plan-title-cancel-requested" })
                    }
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <>
                  <h1
                    className="text-2xl font-bold cursor-pointer hover:text-muted-foreground transition-colors"
                    onClick={() => dispatch({ type: "plan-title-clicked" })}
                  >
                    {plan.title}
                  </h1>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 opacity-0 group-hover/title:opacity-100 transition-opacity"
                      >
                        <MoreVertical className="w-4 h-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      <DropdownMenuItem
                        onSelect={async () => {
                          const markdown = planToMarkdown(plan, {
                            priorityFilter,
                            iconFilter,
                            pinnedLessonIds,
                          });
                          await navigator.clipboard.writeText(markdown);
                        }}
                      >
                        <ClipboardCopy className="w-4 h-4" />
                        Copy as Markdown
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onSelect={async () => {
                          const newPlan = await duplicatePlan();
                          navigate(`/plans/${newPlan.id}`);
                        }}
                      >
                        <Copy className="w-4 h-4" />
                        Duplicate Plan
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </>
              )}
            </div>
          </div>

          {/* Sticky Stats and Filters */}
          <div className="sticky top-0 z-10 bg-background py-3 -mx-6 px-6 border-b">
            {/* Stats */}
            <div className="flex items-center gap-2">
              {iconStats.code.total > 0 && (
                <span className="inline-flex items-center gap-1.5 rounded-md bg-yellow-500/20 text-yellow-600 px-2 py-1 text-xs font-medium">
                  <Code className="w-3 h-3" />
                  {getPercentage(iconStats.code)}%
                </span>
              )}
              {iconStats.discussion.total > 0 && (
                <span className="inline-flex items-center gap-1.5 rounded-md bg-green-500/20 text-green-600 px-2 py-1 text-xs font-medium">
                  <MessageCircle className="w-3 h-3" />
                  {getPercentage(iconStats.discussion)}%
                </span>
              )}
              {iconStats.watch.total > 0 && (
                <span className="inline-flex items-center gap-1.5 rounded-md bg-purple-500/20 text-purple-600 px-2 py-1 text-xs font-medium">
                  <Play className="w-3 h-3" />
                  {getPercentage(iconStats.watch)}%
                </span>
              )}
              <span className="inline-flex items-center rounded-md bg-secondary px-2 py-1 text-xs font-medium text-secondary-foreground">
                {totalLessons} lessons
              </span>
              <span className="inline-flex items-center rounded-md bg-secondary px-2 py-1 text-xs font-medium text-secondary-foreground">
                ~{estimatedVideos} videos
              </span>
            </div>

            {/* Priority Filter */}
            <div className="flex items-center gap-2 mt-2">
              <span className="text-xs text-muted-foreground">Filter:</span>
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
                            : "bg-gray-500/20 text-gray-500"
                        : "bg-muted text-muted-foreground hover:bg-muted/80"
                    } ${isSelected ? "ring-1 ring-current" : ""}`}
                    onClick={() =>
                      dispatch({
                        type: "priority-filter-toggled",
                        priority,
                      })
                    }
                  >
                    P{priority}
                  </button>
                );
              })}

              {/* Icon Filter */}
              <span className="text-muted-foreground mx-1">|</span>
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
                    onClick={() =>
                      dispatch({
                        type: "icon-filter-toggled",
                        icon,
                      })
                    }
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

          {/* Sections */}
          <DndContext
            sensors={sensors}
            collisionDetection={customCollisionDetection}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={sortedSections.map((s) => s.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="space-y-6">
                {sortedSections.map((section, index) => (
                  <SortableSection
                    key={section.id}
                    section={section}
                    sectionNumber={index + 1}
                    state={state}
                    dispatch={dispatch}
                    allLessons={allFlattenedLessons}
                    priorityFilter={priorityFilter}
                    pinnedLessonIds={pinnedLessonIds}
                    iconFilter={iconFilter}
                    isCollapsed={collapsedSectionIds.has(section.id)}
                    onToggleCollapsed={() => toggleSectionCollapsed(section.id)}
                  />
                ))}
              </div>
            </SortableContext>

            <DragOverlay>
              {activeSection ? (
                <div className="border rounded-lg p-4 bg-background shadow-lg opacity-90">
                  <h2 className="font-semibold text-lg">
                    {activeSection.title}
                  </h2>
                </div>
              ) : activeLesson ? (
                <div className="py-2 px-3 rounded bg-background shadow-lg opacity-90 border">
                  <span className="text-sm">{activeLesson.title}</span>
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>

          {/* Add Section */}
          {state.addingSection.active ? (
            <div className="border rounded-lg p-4 border-dashed mt-6">
              <div className="flex items-center gap-2">
                <Input
                  value={state.addingSection.value}
                  onChange={(e) =>
                    dispatch({
                      type: "new-section-title-changed",
                      value: e.target.value,
                    })
                  }
                  placeholder="New section title..."
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter")
                      dispatch({ type: "new-section-save-requested" });
                    if (e.key === "Escape")
                      dispatch({ type: "new-section-cancel-requested" });
                  }}
                />
                <Button
                  onClick={() =>
                    dispatch({ type: "new-section-save-requested" })
                  }
                  disabled={!state.addingSection.value.trim()}
                >
                  Add
                </Button>
                <Button
                  variant="ghost"
                  onClick={() =>
                    dispatch({ type: "new-section-cancel-requested" })
                  }
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button
              variant="outline"
              className="mt-6 w-full border-dashed"
              onClick={() => dispatch({ type: "add-section-clicked" })}
            >
              <Plus className="w-4 h-4 mr-2" />
              Add Section
            </Button>
          )}
        </div>
      </div>

      {/* Delete Section Confirmation Dialog */}
      <Dialog
        open={state.deletingSection !== null}
        onOpenChange={(open) => {
          if (!open) dispatch({ type: "section-delete-cancelled" });
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Section?</DialogTitle>
            <DialogDescription>
              This section contains{" "}
              {state.deletingSection?.lessonCount === 1
                ? "1 lesson"
                : `${state.deletingSection?.lessonCount} lessons`}
              . Deleting this section will also delete all its lessons. This
              action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => dispatch({ type: "section-delete-cancelled" })}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => dispatch({ type: "section-delete-confirmed" })}
            >
              Delete Section
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Lesson Confirmation Dialog */}
      <Dialog
        open={state.deletingLesson !== null}
        onOpenChange={(open) => {
          if (!open) dispatch({ type: "lesson-delete-cancelled" });
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Lesson?</DialogTitle>
            <DialogDescription>This action cannot be undone.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => dispatch({ type: "lesson-delete-cancelled" })}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => dispatch({ type: "lesson-delete-confirmed" })}
            >
              Delete Lesson
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
