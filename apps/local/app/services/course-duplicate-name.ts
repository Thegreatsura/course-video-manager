import { Data, Effect } from "effect";
import { CourseOperationsService } from "@/services/db-course-operations.server";

export class DuplicateCourseNameError extends Data.TaggedError(
  "DuplicateCourseNameError"
)<{ readonly message: string }> {}

/**
 * Whether `name` may be a copy of Course `sourceCourseId`: not the source's
 * own name, and no other Course, archived or not, holds it. The route asks
 * before it enqueues, so the modal can say so; the `duplicate-course` Job asks
 * again before it copies, since another copy may have taken the name since.
 */
export const checkDuplicateCourseName = Effect.fn("checkDuplicateCourseName")(
  function* (input: { sourceCourseId: string; name: string }) {
    const courseOps = yield* CourseOperationsService;
    const sourceCourse = yield* courseOps.getCourseById(input.sourceCourseId);
    if (input.name === sourceCourse.name) {
      return yield* new DuplicateCourseNameError({
        message: "New course name must differ from the original",
      });
    }
    const all = [
      ...(yield* courseOps.getCourses()),
      ...(yield* courseOps.getArchivedCourses()),
    ];
    if (all.some((course) => course.name === input.name)) {
      return yield* new DuplicateCourseNameError({
        message: "A course with this name already exists",
      });
    }
    return sourceCourse;
  }
);
