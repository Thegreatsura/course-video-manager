import { Data, Effect } from "effect";
import { JOB_PARAMS } from "../job-params";
import { CoursePublishService } from "@/services/course-publish-service";
import type { PublishDetailEvent } from "@/services/course-publish-export-events";
import { placeholderFloorFromBand } from "@/packages/course-json";
import { defineJobKind } from "../job-kind";
import { makeOrderedEvents } from "../ordered-events";
import { UPLOAD_MANAGER_POLICIES } from "../retry-policy";

/**
 * The Job Events a Publish writes, beside the ones every Job has. The
 * per-Video ones are the Batch export's, plus the two the upload half adds,
 * so the jobs reducer draws a Publish as the browser did: a parent row and
 * one child row per shipping Video (`jobs-selectors.ts`).
 */
export const PUBLISH_EVENTS = {
  /** The publish lifecycle stage (`PublishStage`): `{ stage }`. */
  stage: "stage",
  /** Every Video this Publish ships, before either pool starts: `{ videos: [{ id, title }] }`. */
  videos: "videos",
  /** An export stage of one Video: `{ videoId, stage }`. */
  videoStage: "video-stage",
  videoProgress: "video-progress",
  /** Its bytes exist; it waits for a slot in the upload pool: `{ videoId }`. */
  videoUploadQueued: "video-upload-queued",
  /** Bytes moving: `{ videoId, uploadedBytes, totalBytes }`. */
  videoUploadProgress: "video-upload-progress",
  /** Its bytes are in the Bundle (uploaded, or copied from the last one): `{ videoId }`. */
  videoSucceeded: "video-succeeded",
  /** Its export or its upload failed: `{ videoId, message }`. */
  videoFailed: "video-failed",
  /** The Promote landed: `{ publishedVersionId, newDraftVersionId, lessons }`. */
  published: "published",
  /**
   * Why the Publish stopped, as the error's own tag and fields — what the
   * in-process CLI used to see, so `cvm course publish --wait` can exit as it
   * did (3 for a `PublishValidationError`, 4 for a `PublishCommitFailedError`).
   */
  publishFailed: "publish-failed",
} as const;

/**
 * Why a Publish stopped, worded as the `publish-sse` route worded it for the
 * toast. The service's own error is kept as `cause`, so the Job's log has the
 * whole chain.
 */
export class PublishRunError extends Data.TaggedError("PublishRunError")<{
  readonly message: string;
  readonly cause: unknown;
}> {}

const firstLine = (text: string | undefined) =>
  (text ?? "").split("\n").find((line) => line.trim() !== "") ?? "";

/** The fields of a tagged error that can travel in a Job Event. */
const plainFields = (error: object): Record<string, unknown> =>
  JSON.parse(
    JSON.stringify(error, (_key, value) =>
      typeof value === "bigint" ? String(value) : value
    )
  ) as Record<string, unknown>;

/**
 * The service reports through two synchronous callbacks; each report becomes
 * a Job Event, written in order by one fiber. Progress is written only when
 * it changes: ffmpeg repeats a percentage many times over, and Dropbox
 * reports every chunk.
 */
const reportInOrder = (events: {
  readonly emit: (event: string, data: Record<string, unknown>) => void;
}) => {
  const lastExportPercent = new Map<string, string>();
  const lastUploadPercent = new Map<string, number>();
  const onDetailEvent = (event: PublishDetailEvent) => {
    switch (event.event) {
      case "upload-videos":
        return events.emit(PUBLISH_EVENTS.videos, event.data);
      case "stage":
        // `queued` is a place in the export pool; the roster already says it.
        if (event.data.stage === "queued") return;
        lastExportPercent.delete(event.data.videoId);
        return events.emit(PUBLISH_EVENTS.videoStage, event.data);
      case "video-progress": {
        const key = `${event.data.stage}:${event.data.percent}`;
        if (lastExportPercent.get(event.data.videoId) === key) return;
        lastExportPercent.set(event.data.videoId, key);
        return events.emit(PUBLISH_EVENTS.videoProgress, event.data);
      }
      case "error":
      case "upload-video-error":
        return events.emit(PUBLISH_EVENTS.videoFailed, event.data);
      case "upload-queued":
        return events.emit(PUBLISH_EVENTS.videoUploadQueued, event.data);
      case "upload-video-progress": {
        const { videoId, uploadedBytes, totalBytes } = event.data;
        const percent =
          totalBytes > 0 ? Math.floor((100 * uploadedBytes) / totalBytes) : 0;
        // The first report (0 bytes) carries the size; after that, a change.
        if (lastUploadPercent.get(videoId) === percent) return;
        lastUploadPercent.set(videoId, percent);
        return events.emit(PUBLISH_EVENTS.videoUploadProgress, event.data);
      }
      // A copy from the last Bundle is this Video's bytes landing too. The
      // browser had no handler for it, so a copied Video's row sat at
      // "queued for upload" until the Publish ended.
      case "upload-video-complete":
      case "upload-video-reused":
        return events.emit(PUBLISH_EVENTS.videoSucceeded, {
          videoId: event.data.videoId,
        });
      // The export roster is a subset of the shipping one; an export's
      // `complete` is followed by its `upload-queued`; and the commit's
      // overall percentage is the children's. The browser used none of them.
      case "videos":
      case "complete":
      case "progress":
        return;
    }
  };
  return { onDetailEvent };
};

/**
 * **Publish** (#9 in docs/plans/background-jobs-sidecar.md): the same
 * `CoursePublishService.publish` the `publish-sse` route ran — validate,
 * Submit, export and upload overlapped, the `course.json` receipt, Promote —
 * now driven by the sidecar, so closing the tab no longer stops it.
 *
 * - The `publish` lane runs one at a time: it replaces the service's
 *   `courseVersionMutationSemaphore`.
 * - 1 attempt: the browser reported every Publish failure as
 *   `UPLOAD_FATAL_ERROR`. A failed export or Commit has already Discarded the
 *   Pending Version inside the service (issue #1401).
 * - Never run again on its own (`neverRequeued`), not even after a
 *   deliberate stop. A run cut off after Submit leaves a Pending Version; the
 *   publish page reads its `course.json` receipt and offers Promote or
 *   Discard, by hand (section 7.2). Only the author starts another Publish.
 */
export const publishJobKind = defineJobKind({
  ...UPLOAD_MANAGER_POLICIES.publish,
  params: JOB_PARAMS["publish"],
  run: (params, ctx) =>
    Effect.gen(function* () {
      const publishService = yield* CoursePublishService;
      const events = yield* makeOrderedEvents(ctx);
      const reports = reportInOrder(events);
      yield* Effect.logInfo("publish: started", params);

      const result = yield* publishService
        .publish({
          courseId: params.courseId,
          versionName: params.name,
          versionDescription: params.description,
          includeTodoLessons: params.includeTodoLessons,
          placeholderFloor: placeholderFloorFromBand(params.placeholders),
          onStageChange: (stage) =>
            events.emit(PUBLISH_EVENTS.stage, { stage }),
          onDetailEvent: reports.onDetailEvent,
        })
        .pipe(
          Effect.ensuring(events.flush),
          Effect.tapError((error) =>
            typeof error === "object" && error !== null && "_tag" in error
              ? ctx.emit(PUBLISH_EVENTS.publishFailed, plainFields(error))
              : Effect.void
          ),
          Effect.catchTags({
            PublishValidationError: (cause) => {
              const parts: string[] = [];
              if (cause.courseViewLintCount && cause.courseViewLintCount > 0) {
                parts.push(
                  `${cause.courseViewLintCount} course warning(s) must be fixed`
                );
              }
              if (
                cause.failedExportVideoIds &&
                cause.failedExportVideoIds.length > 0
              ) {
                parts.push(
                  `${cause.failedExportVideoIds.length} video(s) failed to export`
                );
              }
              return new PublishRunError({
                message: parts.join("; ") || "Publish validation failed",
                cause,
              });
            },
            // A caught Commit failure has auto-Discarded the Pending Version
            // (issue #1401): terminal, nothing to recover. The Submitted
            // content lives on in the new Draft.
            PublishCommitFailedError: (cause) => {
              const missing = cause.missingVideoIds ?? [];
              return new PublishRunError({
                message:
                  cause.reason === "missing_assets"
                    ? `Publish discarded: ${missing.length} video file(s) were missing from the export directory (${missing.join(", ")}). Nothing was lost — your edits are safe in the Draft. Re-export and publish again`
                    : // The route said only "the Dropbox commit failed"; the
                      // cause's first line is what the author can act on.
                      `Publish discarded: the Dropbox commit failed (after one retry): ${firstLine(cause.message) || "no cause recorded"}. Nothing was lost — your edits are safe in the Draft. Publish again when Dropbox is reachable`,
                cause,
              });
            },
            NotFoundError: (cause) =>
              new PublishRunError({ message: "Course not found", cause }),
          })
        );

      yield* ctx.emit(PUBLISH_EVENTS.published, {
        publishedVersionId: result.publishedVersionId,
        newDraftVersionId: result.newDraftVersionId,
        lessons: result.lessonCounts,
      });
      yield* Effect.logInfo("publish: done", {
        publishedVersionId: result.publishedVersionId,
        newDraftVersionId: result.newDraftVersionId,
        lessons: result.lessonCounts,
      });
    }),
});
