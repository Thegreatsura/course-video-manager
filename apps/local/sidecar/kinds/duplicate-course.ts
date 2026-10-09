import { Data, Effect } from "effect";
import { JobOperationsService } from "@cvm/core/services/db-job-operations.server";
import { CourseOperationsService } from "@/services/db-course-operations.server";
import { checkDuplicateCourseName } from "@/services/course-duplicate-name";
import {
  copyPlannedFile,
  planDuplicatedVideoFiles,
  verifyPlannedFiles,
} from "@/services/course-duplicate-files";
import {
  COURSE_FILES_COPIED_EVENT,
  COURSE_ROWS_COPIED_EVENT,
  courseRowsCopiedOf,
} from "@/features/jobs/duplicate-course-job";
import { defineJobKind } from "../job-kind";
import { JOB_PARAMS } from "../job-params";
import { COURSE_DUPLICATE_POLICY } from "../retry-policy";

/**
 * The new Course's rows committed, but the run that copied them was lost
 * before it could record which Videos they were: the files cannot be matched
 * to their Videos, so this says so rather than finishing without them.
 */
export class DuplicateRowsUnrecordedError extends Data.TaggedError(
  "DuplicateRowsUnrecordedError"
)<{ readonly courseId: string; readonly message: string }> {}

/**
 * **Course duplicate**, enqueued by the Duplicate Course modal
 * (`POST /api/courses/<id>/duplicate`). Two halves:
 *
 * 1. The rows, in one transaction (`duplicateCourse`, PR #1963), under the
 *    Course id the route chose. The transaction locks the name and checks it,
 *    so two Jobs copying under one name make one Course. The Course commits
 *    archived: it stays out of the Courses list until its files are in. What it produced — the Course and each Video
 *    paired with its source — is recorded as a `course-rows-copied` Job Event.
 *    A resumed run that finds that event skips the rows.
 * 2. The files: every Video's Clip Mockup frames and WAVs and its Video Files
 *    (`services/course-duplicate-files.ts`). A file already in place is
 *    skipped, each copy is checked against its source's size, and at the end
 *    every file is checked again; a missing one fails the Job by name. Only
 *    then is the Course un-archived. A Job that fails for good leaves it
 *    archived, so a copy short of its files never looks complete.
 *
 * 2 attempts (`COURSE_DUPLICATE_POLICY`): a run the Sidecar loses resumes.
 */
export const duplicateCourseJobKind = defineJobKind({
  ...COURSE_DUPLICATE_POLICY,
  params: JOB_PARAMS["duplicate-course"],
  run: (params, ctx) =>
    Effect.gen(function* () {
      const ops = yield* JobOperationsService;
      const courseOps = yield* CourseOperationsService;

      let rows = courseRowsCopiedOf(yield* ops.listJobEvents(ctx.jobId));
      if (rows) {
        yield* Effect.logInfo("duplicate-course: rows already copied", {
          courseId: rows.courseId,
          videos: rows.videos.length,
        });
      } else {
        const committed = yield* courseOps
          .getCourseById(params.newCourseId)
          .pipe(
            Effect.as(true),
            Effect.catchTag("NotFoundError", () => Effect.succeed(false))
          );
        if (committed) {
          return yield* new DuplicateRowsUnrecordedError({
            courseId: params.newCourseId,
            message: `"${params.name}" was copied, but the run was lost before it recorded its Videos, so its frames, WAVs and Video Files were not copied. Delete "${params.name}" and duplicate again.`,
          });
        }
        yield* ctx.emit("stage", { stage: "copying-rows" });
        yield* checkDuplicateCourseName({
          sourceCourseId: params.sourceCourseId,
          name: params.name,
        });
        const result = yield* courseOps.duplicateCourse({
          sourceCourseId: params.sourceCourseId,
          name: params.name,
          newCourseId: params.newCourseId,
          archived: true,
        });
        rows = {
          courseId: result.course.id,
          videos: result.videoLineageMappings,
        };
        // Straight to the table, so a failed write fails the run: the files
        // are copied only for Videos this Job has on record.
        yield* ops.appendJobEvent({
          jobId: ctx.jobId,
          type: COURSE_ROWS_COPIED_EVENT,
          data: { ...rows, videos: [...rows.videos] },
        });
        yield* Effect.logInfo("duplicate-course: rows copied", {
          courseId: rows.courseId,
          videos: rows.videos.length,
        });
      }

      yield* ctx.emit("progress", { stage: "copying-files", percent: 0 });
      const planned = (yield* Effect.forEach(
        rows.videos,
        planDuplicatedVideoFiles
      )).flat();
      let done = 0;
      let copied = 0;
      let lastPercent = 0;
      for (const file of planned) {
        if ((yield* copyPlannedFile(file)) === "copied") copied++;
        done++;
        const percent = Math.floor((done / planned.length) * 100);
        if (percent > lastPercent) {
          lastPercent = percent;
          yield* ctx.emit("progress", { stage: "copying-files", percent });
        }
      }
      yield* verifyPlannedFiles(planned);
      yield* courseOps.updateCourseArchiveStatus({
        repoId: rows.courseId,
        archived: false,
      });

      const summary = {
        files: planned.length,
        copied,
        skipped: planned.length - copied,
      };
      yield* Effect.logInfo("duplicate-course: files copied", summary);
      yield* ctx.emit(COURSE_FILES_COPIED_EVENT, summary);
    }),
});
