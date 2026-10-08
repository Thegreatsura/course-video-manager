import { Effect, Fiber, Queue, Schema } from "effect";
import { CoursePublishService } from "@/services/course-publish-service";
import type { ExportStage } from "@/services/course-publish-export-events";
import { defineJobKind, type JobContext } from "../job-kind";
import { UPLOAD_MANAGER_POLICIES } from "../retry-policy";

/** The stages an export reports; `queued` is the browser's, before it starts. */
type ExportWorkStage = Exclude<ExportStage, "queued">;

type ExportReport =
  | { readonly type: "stage"; readonly stage: ExportWorkStage }
  | {
      readonly type: "progress";
      readonly stage: ExportWorkStage;
      readonly percent: number;
    }
  | { readonly type: "done" };

/**
 * The export service reports through plain callbacks, but a Job Event is a
 * database write. The callbacks drop each report into a queue, and one fiber
 * writes them in order — so a `progress` event never lands before the
 * `stage` it belongs to, and none is lost when the export finishes.
 */
const reportInOrder = (ctx: JobContext) =>
  Effect.gen(function* () {
    const queue = yield* Queue.unbounded<ExportReport>();
    const writer = yield* Effect.fork(
      Effect.gen(function* () {
        while (true) {
          const report = yield* Queue.take(queue);
          switch (report.type) {
            case "done":
              return;
            case "stage":
              yield* ctx.emit("stage", { stage: report.stage });
              break;
            case "progress":
              yield* ctx.emit("progress", {
                stage: report.stage,
                percent: report.percent,
              });
              break;
          }
        }
      })
    );
    // ffmpeg repeats a percentage many times over; only a change is news.
    let last: { stage: ExportWorkStage; percent: number } | null = null;
    return {
      onStage: (stage: ExportWorkStage) => {
        last = null;
        Queue.unsafeOffer(queue, { type: "stage", stage });
      },
      onProgress: (info: { stage: ExportWorkStage; percent: number }) => {
        if (last?.stage === info.stage && last.percent === info.percent) {
          return;
        }
        last = info;
        Queue.unsafeOffer(queue, { type: "progress", ...info });
      },
      /** Write what is still queued, then stop the writer. */
      flush: Effect.suspend(() => {
        Queue.unsafeOffer(queue, { type: "done" });
        return Fiber.join(writer);
      }),
    };
  });

/**
 * **Video export** (#6 in docs/plans/background-jobs-sidecar.md): the same
 * `CoursePublishService.exportVideo` the `export-sse` route used to run, now
 * driven by the sidecar, so closing the tab no longer stops it. Its stages and
 * ffmpeg percentages become `stage` / `progress` Job Events, which the Upload
 * Manager draws exactly as it drew the stream's. 3 attempts, in the default
 * lane — copied from the Upload Manager (`retry-policy.ts`).
 */
export const exportJobKind = defineJobKind({
  ...UPLOAD_MANAGER_POLICIES.export,
  params: Schema.Struct({ videoId: Schema.String }),
  run: (params, ctx) =>
    Effect.gen(function* () {
      const publish = yield* CoursePublishService;
      const reports = yield* reportInOrder(ctx);
      yield* Effect.logInfo("export: started", { videoId: params.videoId });
      const exportPath = yield* publish
        .exportVideo(params.videoId, reports.onStage, reports.onProgress)
        .pipe(Effect.ensuring(reports.flush));
      yield* Effect.logInfo("export: done", { exportPath });
    }),
});
