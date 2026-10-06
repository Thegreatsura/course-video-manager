export type EffectiveAuthoringStatus = "todo" | "done";

/**
 * The one reading of `lessons.authoringStatus`. The column is nullable and
 * legacy Lessons carry null, which means DONE: a Lesson only counts as todo
 * once someone marked it so. Every surface goes through here.
 */
export const effectiveAuthoringStatus = (
  status: string | null | undefined
): EffectiveAuthoringStatus => (status === "todo" ? "todo" : "done");

export const isTodoLesson = (lesson: {
  authoringStatus: string | null | undefined;
}): boolean => effectiveAuthoringStatus(lesson.authoringStatus) === "todo";
