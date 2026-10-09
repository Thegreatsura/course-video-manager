import { Either, Schema } from "effect";

/**
 * Duplicating a Course, as both ends name it: the route checks the name and
 * enqueues a `duplicate-course` Job (`routes/api.courses.$courseId.duplicate.ts`),
 * the Sidecar runs it (`sidecar/kinds/duplicate-course.ts`), and the jobs
 * reducer draws its row (`jobs-selectors.ts`).
 *
 * The Job's subject is the NEW Course, whose id the route chooses up front:
 * a resumed run can then tell whether the row copy already committed, and the
 * row links to the copy once it is done.
 */
export const DUPLICATE_COURSE_JOB_KIND = "duplicate-course";

/** The two halves of the work, as `stage` and `progress` Job Events name them. */
export const DUPLICATE_COURSE_STAGES = [
  "copying-rows",
  "copying-files",
] as const;
export type DuplicateCourseStage = (typeof DUPLICATE_COURSE_STAGES)[number];

export const isDuplicateCourseStage = (
  stage: string
): stage is DuplicateCourseStage =>
  (DUPLICATE_COURSE_STAGES as readonly string[]).includes(stage);

/**
 * The row copy committed: the new Course, and every Video it produced paired
 * with the Video it came from. Recorded before a single file is copied, so a
 * run that is cut off and resumed copies the files for exactly these Videos
 * and never copies the rows twice.
 */
export const COURSE_ROWS_COPIED_EVENT = "course-rows-copied";

/** Every file is in place and checked: `{ files, copied, skipped }`. */
export const COURSE_FILES_COPIED_EVENT = "course-files-copied";

export const DuplicatedVideo = Schema.Struct({
  sourceLineageId: Schema.String,
  newLineageId: Schema.String,
  newVideoId: Schema.String,
});

export const CourseRowsCopied = Schema.Struct({
  courseId: Schema.String,
  videos: Schema.Array(DuplicatedVideo),
});
export type CourseRowsCopied = typeof CourseRowsCopied.Type;

/** The row copy this Job recorded, if an earlier run of it got that far. */
export const courseRowsCopiedOf = (
  events: ReadonlyArray<{ readonly type: string; readonly data: unknown }>
): CourseRowsCopied | null => {
  for (const event of events) {
    if (event.type !== COURSE_ROWS_COPIED_EVENT) continue;
    const decoded = Schema.decodeUnknownEither(CourseRowsCopied)(event.data);
    if (Either.isRight(decoded)) return decoded.right;
  }
  return null;
};
