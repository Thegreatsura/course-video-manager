import { Data, Effect, Schema } from "effect";
import { AutofillService } from "@/services/autofill-service";
import { defineJobKind } from "../job-kind";
import { makeOrderedEvents } from "../ordered-events";
import { UPLOAD_MANAGER_POLICIES } from "../retry-policy";

/**
 * The Job Events an Autofill writes, beside the ones every Job has. They are
 * the Batch export's per-Video events (`kinds/batch-export.ts`), so the jobs
 * reducer folds them with no new actions; the Upload Manager draws them as the
 * Autofill's parent row and one child row per Video (`jobs-selectors.ts`).
 */
export const AUTOFILL_EVENTS = {
  /** Every **Autofill Candidate**, before any work starts: `{ videos: [{ id, title }] }`. */
  videos: "videos",
  /** A Video's fields landed, in one transaction: `{ videoId }`. */
  videoSucceeded: "video-succeeded",
  /** Nothing of the Video was written: `{ videoId, message }`. */
  videoFailed: "video-failed",
} as const;

/** What the parent row says it is doing (`AutofillStage` in the Upload Manager). */
export type AutofillJobStage = "selecting" | "writing";

/**
 * Why the run as a whole stopped, worded as the `autofill-sse` route worded it
 * for the toast. The service's own error is kept as `cause` for the Job's log.
 */
export class AutofillRunError extends Data.TaggedError("AutofillRunError")<{
  readonly message: string;
  readonly cause: unknown;
}> {}

/**
 * **Course Autofill** (#10 in docs/plans/background-jobs-sidecar.md): the
 * same `AutofillService.autofillCourseVersion` the `autofill-sse` route used
 * to run — six Videos at a time, a Video's two fields in one transaction, a
 * rate limit backed off `recurs(3)` inside the service — now driven by the
 * sidecar, so closing the tab no longer stops it.
 *
 * 1 attempt, in the default lane (`retry-policy.ts`): the browser reported
 * every Autofill failure as `UPLOAD_FATAL_ERROR`, and nothing held a second
 * Autofill back. A Video that fails is not a failed Job: the run carries on,
 * as it did, and the Video's failure is a `video-failed` event (and a line in
 * the Job's log). Only a run that cannot start — the Version is no longer a
 * Draft, or is gone — fails the Job.
 *
 * A deliberate stop puts the Job back (section 7.5); its re-run selects again,
 * and a Video the first run filled is no longer a candidate.
 */
export const autofillJobKind = defineJobKind({
  ...UPLOAD_MANAGER_POLICIES.autofill,
  params: Schema.Struct({
    /** For the success toast's "Back to Publish"; the run reads only the Version. */
    courseId: Schema.String,
    versionId: Schema.String,
    // Required, as the route had it: it decides which Videos the run acts on.
    includeTodoLessons: Schema.Boolean,
  }),
  run: (params, ctx) =>
    Effect.gen(function* () {
      const autofill = yield* AutofillService;
      const events = yield* makeOrderedEvents(ctx);
      const stage = (stage: AutofillJobStage) =>
        events.emit("stage", { stage });
      yield* Effect.logInfo("autofill: started", params);
      stage("selecting");

      const result = yield* autofill
        .autofillCourseVersion({
          versionId: params.versionId,
          includeTodoLessons: params.includeTodoLessons,
          // Only candidates are named: a Video with no work gets no row.
          onCandidates: (selection) => {
            events.emit(AUTOFILL_EVENTS.videos, {
              videos: selection.candidates.map((candidate) => ({
                id: candidate.videoId,
                title: candidate.title,
              })),
            });
            stage("writing");
          },
          onVideoSettled: (video) => {
            if (video.status === "filled") {
              events.emit(AUTOFILL_EVENTS.videoSucceeded, {
                videoId: video.videoId,
                fields: video.fields,
              });
            } else {
              events.emit(AUTOFILL_EVENTS.videoFailed, {
                videoId: video.videoId,
                message: video.message ?? "Autofill failed",
              });
            }
          },
        })
        .pipe(
          Effect.ensuring(events.flush),
          Effect.catchTags({
            AutofillVersionNotDraftError: (cause) =>
              new AutofillRunError({
                message:
                  "Only a Draft Version can be autofilled — reload the publish page",
                cause,
              }),
            NotFoundError: (cause) =>
              new AutofillRunError({
                message: "Course version not found",
                cause,
              }),
          })
        );

      // A Video's failure never fails the run, so it is logged here: no
      // failure leaves the sidecar without a line in the Job's log.
      for (const video of result.results) {
        if (video.status === "failed") {
          yield* Effect.logWarning("autofill: a Video failed", {
            videoId: video.videoId,
            title: video.title,
            message: video.message,
          });
        }
      }
      yield* Effect.logInfo("autofill: done", {
        filled: result.results.filter((r) => r.status === "filled").length,
        failed: result.results.filter((r) => r.status === "failed").length,
        skipped: result.skipped.length,
      });
    }),
});
