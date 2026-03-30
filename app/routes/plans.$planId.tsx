import { AppSidebar } from "@/components/app-sidebar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { usePlanReducer } from "@/hooks/use-plan-reducer";
import {
  AlertTriangle,
  ChevronLeft,
  ClipboardCopy,
  Copy,
  MoreVertical,
  Plus,
  RefreshCw,
} from "lucide-react";
import { useState, useCallback } from "react";
import { Link, useNavigate, data } from "react-router";
import type { Lesson } from "@/features/course-planner/types";
import type { Route } from "./+types/plans.$planId";
import { Console, Effect } from "effect";
import { DBFunctionsService } from "@/services/db-service.server";
import { runtimeLive } from "@/services/layer.server";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
  DragOverlay,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import type { Section } from "@/features/course-planner/types";
import { NotFoundError } from "@/services/db-service-errors";
import {
  customCollisionDetection,
  planToMarkdown,
  type FlattenedLesson,
} from "@/features/course-planner/plans-planId-utils";
import { SortableSection } from "@/features/course-planner/plans-planId-sortable-section";
import {
  PlanStatsBar,
  PlanDeleteDialogs,
} from "@/features/course-planner/plans-planId-components";

export const loader = async ({ params }: Route.LoaderArgs) => {
  return Effect.gen(function* () {
    const db = yield* DBFunctionsService;
    const [courses, standaloneVideos, plans] = yield* Effect.all([
      db.getCourses(),
      db.getStandaloneVideosSidebar(),
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
    return { plan, plans, courses, standaloneVideos };
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

export const meta: Route.MetaFunction = () => {
  return [{ title: "Plan - CVM" }];
};

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
          courses={loaderData.courses}
          standaloneVideos={loaderData.standaloneVideos}
          plans={loaderData.plans}
        />
        <div className="flex-1 p-6">
          <div className="text-center py-12">
            <h1 className="text-2xl font-bold mb-4">Plan not found</h1>
            <Link to="/">
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

  // Build dependency map for circular dependency detection
  const dependencyMap: Record<string, string[]> = {};
  for (const section of sortedSections) {
    for (const lesson of section.lessons) {
      if (lesson.dependencies && lesson.dependencies.length > 0) {
        dependencyMap[lesson.id] = lesson.dependencies;
      }
    }
  }

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
        courses={loaderData.courses}
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
          <PlanStatsBar
            iconStats={iconStats}
            totalLessons={totalLessons}
            estimatedVideos={estimatedVideos}
            priorityFilter={priorityFilter}
            iconFilter={iconFilter}
            dispatch={dispatch}
          />

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
                    dependencyMap={dependencyMap}
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

      <PlanDeleteDialogs
        deletingSection={state.deletingSection}
        deletingLesson={state.deletingLesson}
        dispatch={dispatch}
      />
    </div>
  );
}
