import { Data, Effect, Schedule } from "effect";
import { JobOperationsService } from "@cvm/core/services/db-job-operations.server";
import { DrizzleService } from "@/services/drizzle-service.server";
import { storageRootsConfig } from "@/services/storage-roots";
import { runStorageMove } from "@/packages/storage/move";
import { STORAGE_MOVED_EVENT } from "@/packages/storage/client";
import { defineJobKind, JobCancelledError } from "../job-kind";
import { JOB_PARAMS } from "../job-params";
import { STORAGE_MOVE_POLICY } from "../retry-policy";

/** Some files were not moved; each is named, and each original is untouched. */
export class StorageMoveIncompleteError extends Data.TaggedError(
  "StorageMoveIncompleteError"
)<{ readonly message: string }> {}

/** How often a running move looks for the author's Cancel. */
const CANCEL_POLL_MS = 500;

/**
 * **Storage move** (#2109), enqueued from the Storage page
 * (`POST /api/storage/buckets/<id>/move`): copy a Storage Bucket's Footage,
 * Exported Videos or Clip Mockups to another Storage Root, checking each copy
 * by checksum (`@/packages/storage/move`). It re-checks every refusal before a
 * byte is copied, deletes no original and changes no row and no Export Hash.
 *
 * Cancel: the author's Cancel is a `cancel-requested` Job Event, looked for
 * every half second; the move then removes its partial copies and the Job
 * ends `cancelled`. A lost run resumes each file by size; a stop puts it back.
 */
export const storageMoveJobKind = defineJobKind({
  ...STORAGE_MOVE_POLICY,
  params: JOB_PARAMS["storage-move"],
  run: (params, ctx) =>
    Effect.scoped(
      Effect.gen(function* () {
        const ops = yield* JobOperationsService;
        const db = yield* DrizzleService;
        const roots = yield* storageRootsConfig;

        let cancelRequested = yield* ops.isJobCancelRequested(ctx.jobId);
        // The copy runs outside Effect: it reports its percent here, and
        // this fiber both reports it and looks for the author's Cancel.
        let percent: number | null = null;
        let reported: number | null = null;
        const tick = Effect.gen(function* () {
          if (percent !== null && percent !== reported) {
            reported = percent;
            yield* ctx.emit("progress", { stage: "copying", percent });
          }
          if (yield* ops.isJobCancelRequested(ctx.jobId)) {
            cancelRequested = true;
          }
        }).pipe(Effect.ignore);
        yield* Effect.forkScoped(
          Effect.repeat(tick, Schedule.spaced(CANCEL_POLL_MS))
        );

        yield* ctx.emit("stage", { stage: "checking" });
        const result = yield* runStorageMove({
          db,
          roots,
          bucketId: params.bucketId,
          kind: params.kind,
          target: params.target,
          jobId: ctx.jobId,
          cancelRequested: () => cancelRequested,
          onProgress: (p) => {
            percent = p;
          },
        }).pipe(
          Effect.catchTag("StorageMoveCancelledError", (e) =>
            Effect.fail(new JobCancelledError({ message: e.message }))
          )
        );

        yield* ctx.emit("progress", { stage: "copying", percent: 100 });
        yield* ctx.emit(STORAGE_MOVED_EVENT, {
          ...result,
          left: [...result.left],
        });
        if (result.left.length > 0) {
          const first = result.left.slice(0, 3);
          return yield* new StorageMoveIncompleteError({
            message: `${result.left.length} ${result.left.length === 1 ? "file was" : "files were"} not moved, each original untouched (${result.copied.files} copied and verified): ${first.map((l) => `${l.path}: ${l.message}`).join("; ")}${result.left.length > 3 ? "; …" : ""}`,
          });
        }
      })
    ),
});
