import { Effect, Schema } from "effect";
import { purgeExportedVideos } from "@/packages/storage/purge";
import { startStorageDelete } from "@/packages/storage/delete";
import { purgedFiles, storageDeleteTitle } from "@/packages/storage/client";
import { DrizzleService } from "@/services/drizzle-service.server";
import { makeAction } from "@/services/route-action.server";
import { storageRootsConfig } from "@/services/storage-roots";
import {
  enqueueStorageDeleteJob,
  nudgeAfterEnqueue,
  verifyConfine,
} from "@/services/storage-delete-job.server";

const purgeSchema = Schema.Struct({
  /** Plan only: answer what would go, delete nothing (the confirmation). */
  dryRun: Schema.Boolean,
  /** The Exported Videos ticked on the per-bucket page; absent, the bucket. */
  exportPaths: Schema.optional(Schema.NonEmptyArray(Schema.String)),
  /** The bucket's name as the page shows it: the Job's title only. */
  bucketName: Schema.optional(Schema.String),
});

/**
 * Purge a Course's, Standalone Videos' or Shorts' Exported Videos (#2111).
 * `dryRun`: what a Purge would delete and which Videos it would skip (only
 * Videos whose Footage is all found go). Otherwise every refusal is checked
 * again (409) and a `storage-delete` Sidecar Job does the Purge (#2157);
 * answers `{ jobId }`. Nothing is deleted in this request.
 */
export const action = makeAction({
  input: "json",
  errors: {
    StoragePurgeRefusedError: 409,
    StorageDeleteStartRefusedError: 409,
    UnknownJobKindError: 400,
    NoAttemptsLeftError: 400,
  },
  effect: ({ params, payload }) =>
    Effect.gen(function* () {
      const body = yield* Schema.decodeUnknown(purgeSchema)(payload);
      const db = yield* DrizzleService;
      const roots = yield* storageRootsConfig;
      const bucketId = params.bucketId ?? "";
      const selection =
        body.exportPaths === undefined ? {} : { exportPaths: body.exportPaths };
      const plan = (alreadyHeld: boolean) =>
        Effect.gen(function* () {
          return yield* purgeExportedVideos({
            db,
            roots,
            bucketId,
            dryRun: true,
            alreadyHeld,
            ...selection,
            ...(yield* verifyConfine),
          });
        });
      if (body.dryRun) return yield* plan(false);
      const started = yield* startStorageDelete({
        plan: plan(true),
        nothingToDo: (p) =>
          purgedFiles(p) === 0
            ? "Not deleted: none of these Exported Videos can be deleted (their Footage isn't all found)"
            : null,
        enqueue: () =>
          enqueueStorageDeleteJob({
            bucketId,
            title: storageDeleteTitle({
              operation: "purge-exports",
              bucketName: body.bucketName ?? bucketId,
              locationLabel: "",
              ...(body.exportPaths === undefined
                ? {}
                : { paths: body.exportPaths }),
            }),
            params: { operation: "purge-exports", bucketId, ...selection },
          }),
      });
      yield* nudgeAfterEnqueue();
      return started;
    }),
});
