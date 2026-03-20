import type { Lesson, Section } from "./course-view-types";

export function applyOptimisticLessonUpdates(
  section: Section,
  allSections: Section[],
  opts: {
    reorderFormData: FormData | undefined;
    deleteFormData: FormData | undefined;
    addFormData: FormData | undefined;
    addFormAction: string | undefined;
    moveFormData: FormData | undefined;
  }
): Lesson[] {
  let lessons = section.lessons;

  // Optimistic lesson reordering
  if (
    opts.reorderFormData &&
    opts.reorderFormData.get("sectionId") === section.id
  ) {
    const lessonIds = JSON.parse(
      opts.reorderFormData.get("lessonIds") as string
    ) as string[];
    const lessonMap = new Map(section.lessons.map((l) => [l.id, l]));
    const reordered = lessonIds
      .map((id) => lessonMap.get(id))
      .filter(Boolean) as Lesson[];
    if (reordered.length === section.lessons.length) {
      lessons = reordered;
    }
  }

  // Optimistic lesson deletion
  const pendingDeleteId = opts.deleteFormData?.get("lessonId") as string | null;
  if (pendingDeleteId) {
    lessons = lessons.filter((l) => l.id !== pendingDeleteId);
  }

  // Optimistic lesson addition (ghost or real)
  if (opts.addFormData && opts.addFormData.get("sectionId") === section.id) {
    const lessonTitle = opts.addFormData.get("title") as string;
    // Skip optimistic lesson if a real lesson with the same title
    // already exists (loader revalidated before fetcher went idle)
    const alreadyExists = lessons.some(
      (l) =>
        (l.title === lessonTitle || l.path === lessonTitle) &&
        !l.id.startsWith("optimistic-")
    );

    if (!alreadyExists) {
      const isRealMode = opts.addFormAction?.includes("create-real");
      const adjLessonId = opts.addFormData.get("adjacentLessonId") as
        | string
        | null;
      const pos = opts.addFormData.get("position") as "before" | "after" | null;

      const optimisticLesson = {
        id: `optimistic-lesson-${lessonTitle}`,
        path: lessonTitle,
        title: lessonTitle,
        fsStatus: isRealMode ? "real" : "ghost",
        description: "",
        icon: null,
        priority: 2,
        dependencies: [],
        order: lessons.length,
        videos: [],
        createdAt: new Date(),
        previousVersionLessonId: null,
        sectionId: section.id,
      } as Lesson;

      if (adjLessonId && pos) {
        const adjIdx = lessons.findIndex((l) => l.id === adjLessonId);
        if (adjIdx !== -1) {
          const insertIdx = pos === "after" ? adjIdx + 1 : adjIdx;
          lessons = [
            ...lessons.slice(0, insertIdx),
            optimisticLesson,
            ...lessons.slice(insertIdx),
          ];
        } else {
          lessons = [...lessons, optimisticLesson];
        }
      } else {
        lessons = [...lessons, optimisticLesson];
      }
    }
  }

  // Optimistic lesson move between sections
  if (opts.moveFormData) {
    const movedLessonId = opts.moveFormData.get("lessonId") as string;
    const targetSectionId = opts.moveFormData.get("sectionId") as string;
    if (targetSectionId !== section.id) {
      lessons = lessons.filter((l) => l.id !== movedLessonId);
    }
    if (targetSectionId === section.id) {
      const movedLesson = allSections
        .flatMap((s) => s.lessons)
        .find((l) => l.id === movedLessonId);
      if (movedLesson && !lessons.some((l) => l.id === movedLessonId)) {
        lessons = [...lessons, { ...movedLesson, sectionId: section.id }];
      }
    }
  }

  return lessons;
}

export function filterLessons(
  lessons: Lesson[],
  opts: {
    priorityFilter: number[];
    iconFilter: string[];
    fsStatusFilter: string | null;
    searchQuery: string;
  }
): { filteredLessons: Lesson[]; hasActiveFilters: boolean } {
  const { priorityFilter, iconFilter, fsStatusFilter, searchQuery } = opts;
  const hasActiveFilters =
    priorityFilter.length > 0 ||
    iconFilter.length > 0 ||
    fsStatusFilter !== null ||
    searchQuery.length > 0;

  if (!hasActiveFilters) return { filteredLessons: lessons, hasActiveFilters };

  const filteredLessons = lessons.filter((lesson) => {
    const passesPriorityFilter =
      priorityFilter.length === 0 ||
      priorityFilter.includes(lesson.priority ?? 2);
    const passesIconFilter =
      iconFilter.length === 0 || iconFilter.includes(lesson.icon ?? "watch");
    const passesFsStatusFilter = (() => {
      if (fsStatusFilter === null) return true;
      if (fsStatusFilter === "ghost")
        return (lesson.fsStatus ?? "real") === "ghost";
      if (fsStatusFilter === "real")
        return (lesson.fsStatus ?? "real") === "real";
      // "todo" filter
      if ((lesson.fsStatus ?? "real") !== "real") return false;
      if (lesson.videos.length === 0) return true;
      if (lesson.videos.every((v) => v.clipCount > 1)) return false;
      return lesson.videos.some((v) => v.clipCount === 0);
    })();
    const passesSearch = (() => {
      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase();
      if (lesson.path.toLowerCase().includes(q)) return true;
      if (lesson.title?.toLowerCase().includes(q)) return true;
      if (lesson.description?.toLowerCase().includes(q)) return true;
      return lesson.videos.some((v) => v.path.toLowerCase().includes(q));
    })();
    return (
      passesPriorityFilter &&
      passesIconFilter &&
      passesFsStatusFilter &&
      passesSearch
    );
  });

  return { filteredLessons, hasActiveFilters };
}

export function calcSectionDuration(lessons: Lesson[]): number {
  return lessons.reduce(
    (acc, lesson) =>
      acc +
      lesson.videos.reduce(
        (videoAcc, video) => videoAcc + video.totalDuration,
        0
      ),
    0
  );
}
