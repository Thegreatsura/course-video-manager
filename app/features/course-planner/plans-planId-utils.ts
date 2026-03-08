import {
  closestCenter,
  pointerWithin,
  type CollisionDetection,
} from "@dnd-kit/core";
import type {
  LessonPriority,
  LessonIcon,
  Plan,
  Lesson,
} from "@/features/course-planner/types";

// Custom collision detection that prioritizes lessons over sections
// This allows dropping on a specific lesson position even when crossing sections
export const customCollisionDetection: CollisionDetection = (args) => {
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

// Generate markdown from plan (respects active filters)
export interface PlanToMarkdownOptions {
  priorityFilter: LessonPriority[];
  iconFilter: LessonIcon[];
  pinnedLessonIds: string[];
}

export function planToMarkdown(
  plan: Plan,
  options: PlanToMarkdownOptions
): string {
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
export interface FlattenedLesson {
  id: string;
  number: string;
  title: string;
  sectionId: string;
  sectionTitle: string;
  sectionNumber: number;
  priority: LessonPriority;
}

// Helper to check if dependency order is violated
export function checkDependencyViolation(
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
export function checkPriorityViolation(
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
