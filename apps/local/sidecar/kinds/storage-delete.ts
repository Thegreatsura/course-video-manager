import { Config, Data, Effect, Option, Schedule } from "effect";
import { JobOperationsService } from "@cvm/core/services/db-job-operations.server";
import { DrizzleService } from "@/services/drizzle-service.server";
import {
  storageRootsConfig,
  VERIFY_RUN_DIR_ENV_KEY,
} from "@/services/storage-roots";
import { runDeleteOriginals } from "@/packages/storage/originals";
import { rootLabel } from "@/packages/storage";
import {
  STORAGE_DELETED_EVENT,
  storageDeleteSummary,
  type StorageDeleteJobResult,
} from "@/packages/storage/client";
import { defineJobKind, JobCancelledError } from "../job-kind";
import { JOB_PARAMS } from "../job-params";
import { STORAGE_DELETE_POLICY } from "../retry-policy";

/** Some files were not deleted; each is named and still where it was. */
export class StorageDeleteIncompleteError extends Data.TaggedError(
  "StorageDeleteIncompleteError"
)<{ readonly message: string }> {}

/** How often a running delete looks for the author's Cancel. */
const CANCEL_POLL_MS = 500;

/**
 * **Storage delete** (#2110), enqueued from the Storage page's confirmations
 * (`POST /api/storage/buckets/<id>/delete-originals`): every delete on the
 * Storage page runs here, never inline in a request. One kind, one
 * `operation` per delete (`@/packages/storage/client`'s
 * `STORAGE_DELETE_OPERATIONS`); each reports a `StorageDeleteJobResult` as a
 * `storage-deleted` Job Event and, when any file was left, fails with
 * "N deleted; N files still on D:, retry" so its row says so and Retry runs
 * it again.
 *
 * `originals`: delete the bucket's files on `from` that have an identical
 * copy on another Storage Root, each read again on both and compared by
 * SHA-256 just before it goes (`@/packages/storage/originals`).
 *
 * Cancel: a `cancel-requested` Job Event, looked for every half second; the
 * delete stops before its next file (or mid-checksum), and the Job ends
 * `cancelled`. What it deleted stays deleted: each was a verified duplicate.
 */
export const storageDeleteJobKind = defineJobKind({
  ...STORAGE_DELETE_POLICY,
  params: JOB_PARAMS["storage-delete"],
  run: (params, ctx) =>
    Effect.scoped(
      Effect.gen(function* () {
        const ops = yield* JobOperationsService;
        const db = yield* DrizzleService;
        const roots = yield* storageRootsConfig;
        // A verify-cvm run deletes only inside its own directory.
        const verifyRunDir = yield* Config.option(
          Config.string(VERIFY_RUN_DIR_ENV_KEY)
        );
        const confineTo = Option.match(verifyRunDir, {
          onNone: () => ({}),
          onSome: (dir) => (dir.trim() === "" ? {} : { confineTo: dir }),
        });

        let cancelRequested = yield* ops.isJobCancelRequested(ctx.jobId);
        let percent: number | null = null;
        let reported: number | null = null;
        const tick = Effect.gen(function* () {
          if (percent !== null && percent !== reported) {
            reported = percent;
            yield* ctx.emit("progress", { stage: "deleting", percent });
          }
          if (yield* ops.isJobCancelRequested(ctx.jobId)) {
            cancelRequested = true;
          }
        }).pipe(Effect.ignore);
        yield* Effect.forkScoped(
          Effect.repeat(tick, Schedule.spaced(CANCEL_POLL_MS))
        );

        yield* ctx.emit("stage", { stage: "checking" });
        const originals = yield* runDeleteOriginals({
          db,
          roots,
          bucketId: params.bucketId,
          from: params.from,
          selfJobId: ctx.jobId,
          cancelRequested: () => cancelRequested,
          onProgress: (p) => {
            percent = p;
          },
          ...confineTo,
        }).pipe(
          Effect.catchTag("StorageOriginalsCancelledError", (e) =>
            Effect.fail(new JobCancelledError({ message: e.message }))
          )
        );
        const result: StorageDeleteJobResult = {
          bucketId: originals.bucketId,
          operation: params.operation,
          location: originals.from,
          deleted: originals.deleted,
          kept: originals.kept,
          left: originals.left,
        };

        yield* ctx.emit("progress", { stage: "deleting", percent: 100 });
        yield* ctx.emit(STORAGE_DELETED_EVENT, {
          ...result,
          left: [...result.left],
        });
        if (result.left.length > 0) {
          const first = result.left.slice(0, 3);
          return yield* new StorageDeleteIncompleteError({
            message: `${storageDeleteSummary(result, rootLabel(params.from))}: ${first.map((l) => `${l.path}: ${l.message}`).join("; ")}${result.left.length > 3 ? "; …" : ""}`,
          });
        }
      })
    ),
});
