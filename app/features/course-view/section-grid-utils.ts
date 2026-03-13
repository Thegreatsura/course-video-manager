import type { Lesson } from "./course-view-types";

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
      if (lesson.videos.every((v) => v.clips.length > 1)) return false;
      return lesson.videos.some((v) => v.clips.length === 0);
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
        (videoAcc, video) =>
          videoAcc +
          video.clips.reduce(
            (clipAcc, clip) =>
              clipAcc + (clip.sourceEndTime - clip.sourceStartTime),
            0
          ),
        0
      ),
    0
  );
}
