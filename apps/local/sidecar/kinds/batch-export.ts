import { Cause, Effect, Fiber, Queue, Schema } from "effect";
import { JobOperationsService } from "@cvm/core/services/db-job-operations.server";
import { CoursePublishService } from "@/services/course-publish-service";
import type { PublishDetailEvent } from "@/services/course-publish-export-events";
import {
  defineJobKind,
  type EnqueueJob,
  type JobContext,
  type LostJob,
  type LostRunContext,
} from "../job-kind";
import { UPLOAD_MANAGER_POLICIES } from "../retry-policy";

/**
 * The Job Events a Batch export writes, beside the ones every Job has. The
 * Upload Manager draws one row per Video from them (`jobs-reducer.ts`).
 */
export const BATCH_EXPORT_EVENTS = {
  /** The Videos this run will export: `{ videos: [{ id, title }] }`. */
  videos: "videos",
  videoStage: "video-stage",
  videoProgress: "video-progress",
  videoSucceeded: "video-succeeded",
  /** All its in-batch tries failed: `{ videoId, message }`. */
  videoFailed: "video-failed",
  /** Handed on as a standalone `export` Job: `{ videoId, jobId }`. */
  videoHandedOff: "video-handed-off",
} as const;

/**
 * Attempts a Video already spent inside the batch, as the browser counted
 * them. A failed Batch export row went to `retrying` with `retryCount` 1 and
 * was handed on as a standalone export with the attempts it had left, so a
 * Video runs 3 times in the batch (`recurs(2)`) and 2 more on its own: 5.
 */
const ATTEMPTS_SPENT_IN_THE_BATCH = 1;

/**
 * Hand a Video on as its own `export` Job, with the attempts the browser
 * would have given it, through the one enqueue path (`ctx.enqueue`), then
 * record the `video-handed-off` event the row is replaced by.
 */
const handOff = (
  enqueue: EnqueueJob,
  batchJobId: string,
  video: { id: string; title: string }
) =>
  Effect.gen(function* () {
    const ops = yield* JobOperationsService;
    const job = yield* enqueue({
      kind: "export",
      title: video.title,
      params: { videoId: video.id },
      subject: { type: "video", id: video.id },
      attemptsSpent: ATTEMPTS_SPENT_IN_THE_BATCH,
      dependsOn: null,
    });
    yield* ops.appendJobEvent({
      jobId: batchJobId,
      type: BATCH_EXPORT_EVENTS.videoHandedOff,
      data: { videoId: video.id, jobId: job.id },
    });
    yield* Effect.logInfo("batch-export: handed a Video on as its own export", {
      videoId: video.id,
      exportJobId: job.id,
    });
  });

const isVideoList = (
  value: unknown
): value is ReadonlyArray<{ id: string; title: string }> =>
  Array.isArray(value) &&
  value.every(
    (v) =>
      typeof v === "object" &&
      v !== null &&
      typeof v.id === "string" &&
      typeof v.title === "string"
  );

/**
 * What a batch's own Job Events say it has done so far, over every run — so
 * it is right after a crash. A Video handed on is not handed on again, save
 * for a crash between `handOff`'s two writes (the Job, then its event): that
 * costs a second export of the same content-addressed file, nothing more.
 */
const progressSoFar = (batchJobId: string) =>
  Effect.gen(function* () {
    const ops = yield* JobOperationsService;
    const events = yield* ops.listJobEvents(batchJobId);
    let announced: ReadonlyArray<{ id: string; title: string }> = [];
    const succeeded = new Set<string>();
    const handedOff = new Set<string>();
    for (const event of events) {
      const data = event.data as Record<string, unknown>;
      if (event.type === BATCH_EXPORT_EVENTS.videos) {
        if (isVideoList(data.videos)) announced = data.videos;
      } else if (typeof data.videoId !== "string") {
        continue;
      } else if (event.type === BATCH_EXPORT_EVENTS.videoSucceeded) {
        succeeded.add(data.videoId);
      } else if (event.type === BATCH_EXPORT_EVENTS.videoHandedOff) {
        handedOff.add(data.videoId);
      }
    }
    return { announced, succeeded, handedOff };
  });

const handOffUnfinished = (batch: LostJob, ctx: LostRunContext) =>
  Effect.gen(function* () {
    const { announced, succeeded, handedOff } = yield* progressSoFar(batch.id);
    const unfinished = announced.filter(
      (video) => !succeeded.has(video.id) && !handedOff.has(video.id)
    );
    yield* Effect.forEach(
      unfinished,
      (video) => handOff(ctx.enqueue, batch.id, video),
      { discard: true }
    );
  });

/**
 * The service reports through one synchronous callback; each report becomes
 * a Job Event (and a failed Video a hand-off), written in order by one fiber.
 */
const reportInOrder = (ctx: JobContext) =>
  Effect.gen(function* () {
    type Report =
      | { readonly type: "event"; readonly event: PublishDetailEvent }
      | { readonly type: "done" };
    const queue = yield* Queue.unbounded<Report>();
    const titles = new Map<string, string>();
    const lastPercent = new Map<string, string>();

    const write = (event: PublishDetailEvent) =>
      Effect.gen(function* () {
        switch (event.event) {
          case "videos":
            for (const video of event.data.videos) {
              titles.set(video.id, video.title);
            }
            return yield* ctx.emit(BATCH_EXPORT_EVENTS.videos, event.data);
          case "stage":
            // `queued` is a place in the pool, announced for every Video at
            // once; the `videos` event already says it.
            if (event.data.stage === "queued") return;
            lastPercent.delete(event.data.videoId);
            return yield* ctx.emit(BATCH_EXPORT_EVENTS.videoStage, event.data);
          case "video-progress": {
            // ffmpeg repeats a percentage many times over; only a change is news.
            const key = `${event.data.stage}:${event.data.percent}`;
            if (lastPercent.get(event.data.videoId) === key) return;
            lastPercent.set(event.data.videoId, key);
            return yield* ctx.emit(
              BATCH_EXPORT_EVENTS.videoProgress,
              event.data
            );
          }
          case "complete":
            return yield* ctx.emit(
              BATCH_EXPORT_EVENTS.videoSucceeded,
              event.data
            );
          case "error": {
            yield* ctx.emit(BATCH_EXPORT_EVENTS.videoFailed, event.data);
            // The browser retried a failed row at once, on its own, while
            // the rest of the batch carried on. So does the sidecar.
            const videoId = event.data.videoId;
            return yield* handOff(ctx.enqueue, ctx.jobId, {
              id: videoId,
              title: titles.get(videoId) ?? videoId,
            }).pipe(
              Effect.catchAllCause((cause) =>
                Effect.logError(
                  "batch-export: could not hand a failed Video on",
                  cause
                )
              )
            );
          }
          // A Publish's Dropbox events: a Batch export never sends them.
          case "progress":
          case "upload-videos":
          case "upload-queued":
          case "upload-video-progress":
          case "upload-video-complete":
          case "upload-video-error":
          case "upload-video-reused":
            return;
        }
      });

    const writer = yield* Effect.fork(
      Effect.gen(function* () {
        while (true) {
          const report = yield* Queue.take(queue);
          if (report.type === "done") return;
          yield* write(report.event);
        }
      })
    );
    return {
      onDetailEvent: (event: PublishDetailEvent) => {
        Queue.unsafeOffer(queue, { type: "event", event });
      },
      /** Write what is still queued, then stop the writer. */
      flush: Effect.suspend(() => {
        Queue.unsafeOffer(queue, { type: "done" });
        return Fiber.join(writer);
      }),
    };
  });

/**
 * **Batch export** (#7 in docs/plans/background-jobs-sidecar.md): "Export
 * all" on a Course, through the same `CoursePublishService.batchExport` the
 * `batch-export-sse` route used to run — 6 Videos at a time, each tried 3
 * times (`recurs(2)`) inside the service, unchanged. Driven by the sidecar,
 * so closing the tab no longer stops it.
 *
 * What the browser did around the stream is copied here:
 *
 * - A Video that fails all its in-batch tries is handed on at once as its own
 *   `export` Job with 2 attempts (the browser's standalone retry), and the
 *   batch carries on.
 * - When the batch itself fails (the stream errored), every Video it has not
 *   finished is handed on the same way, as the browser failed each remaining
 *   row and retried it. A run that is lost (`afterLostRun`) does the same.
 *
 * 1 attempt (`retry-policy.ts`): the batch never re-ran as a whole. A
 * deliberate stop puts it back, and the re-run skips every Video already
 * exported (`findShippingVideos`) and every Video already handed on.
 */
export const batchExportJobKind = defineJobKind({
  ...UPLOAD_MANAGER_POLICIES["batch-export"],
  params: Schema.Struct({
    versionId: Schema.String,
    // Export All ships everything unless to-do Lessons are being withheld.
    includeTodoLessons: Schema.optionalWith(Schema.Boolean, {
      default: () => true,
    }),
  }),
  run: (params, ctx) =>
    Effect.gen(function* () {
      const publish = yield* CoursePublishService;
      // A run after a deliberate stop leaves alone the Videos an earlier run
      // handed on: their own export Jobs carry them now.
      const { handedOff } = yield* progressSoFar(ctx.jobId);
      const reports = yield* reportInOrder(ctx);
      yield* Effect.logInfo("batch-export: started", {
        ...params,
        alreadyHandedOn: handedOff.size,
      });
      yield* publish
        .batchExport(
          params.versionId,
          params.includeTodoLessons,
          reports.onDetailEvent,
          handedOff
        )
        .pipe(
          Effect.ensuring(reports.flush),
          // A stop is not the batch failing: a deliberate one puts the Job
          // back, and a lost run is handed on by `afterLostRun`.
          Effect.tapErrorCause((cause) =>
            Cause.isInterruptedOnly(cause)
              ? Effect.void
              : handOffUnfinished({ id: ctx.jobId, title: "" }, ctx).pipe(
                  Effect.catchAllCause((cause) =>
                    Effect.logError(
                      "batch-export: could not hand the unfinished Videos on",
                      cause
                    )
                  )
                )
          )
        );
      yield* Effect.logInfo("batch-export: done");
    }),
  afterLostRun: handOffUnfinished,
});
