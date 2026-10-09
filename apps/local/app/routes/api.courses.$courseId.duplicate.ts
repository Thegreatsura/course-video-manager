import { Effect, Schema } from "effect";
import { checkDuplicateCourseName } from "@/services/course-duplicate-name";
import { makeAction } from "@/services/route-action.server";
import { nudgeSidecar } from "@/services/sidecar-socket.server";
import { DUPLICATE_COURSE_JOB_KIND } from "@/features/jobs/duplicate-course-job";
import { data } from "react-router";
import { enqueueJob, JOB_KIND_SPECS } from "../../sidecar/job-specs";

const duplicateCourseSchema = Schema.Struct({
  name: Schema.String.pipe(
    Schema.minLength(1, { message: () => "Course name cannot be empty" })
  ),
});

/**
 * Duplicate a Course: check the name, so the modal can say what is wrong with
 * it, then enqueue a `duplicate-course` Job (`sidecar/kinds/duplicate-course.ts`)
 * and answer with its id and the new Course's. The Sidecar copies the rows and
 * every Video's files; the Job's row in the Upload Manager shows it, and links
 * to the copy once it is done.
 */
export const action = makeAction({
  input: "formData",
  errors: {
    NotFoundError: 404,
    UnknownJobKindError: 400,
    NoAttemptsLeftError: 400,
  },
  effect: ({ params, payload }) =>
    Effect.gen(function* () {
      const parsed = yield* Schema.decodeUnknown(duplicateCourseSchema)(
        payload
      );
      const name = parsed.name.trim();
      const sourceCourseId = params.courseId!;

      yield* checkDuplicateCourseName({ sourceCourseId, name }).pipe(
        Effect.catchTag("DuplicateCourseNameError", (error) =>
          Effect.die(data({ error: error.message }, { status: 400 }))
        )
      );

      const newCourseId = crypto.randomUUID();
      const job = yield* enqueueJob({
        id: null,
        kind: DUPLICATE_COURSE_JOB_KIND,
        // The copy's name: its row reads "Cohort 003", and a failure toasts
        // "Cohort 003" duplicate failed.
        title: name,
        params: { sourceCourseId, name, newCourseId },
        // The new Course: the row links to it once the copy is done.
        subject: { type: "course", id: newCourseId },
        attemptsSpent: 0,
        dependsOn: null,
        registry: JOB_KIND_SPECS,
      });
      yield* nudgeSidecar();
      return { jobId: job.id, courseId: newCourseId };
    }),
});
