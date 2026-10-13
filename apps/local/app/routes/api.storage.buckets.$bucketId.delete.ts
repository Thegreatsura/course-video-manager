import { Effect, Schema } from "effect";
import {
  deleteOtherStorageBucket,
  startStorageDelete,
} from "@/packages/storage/delete";
import { storageDeleteTitle } from "@/packages/storage/client";
import { DrizzleService } from "@/services/drizzle-service.server";
import { makeAction } from "@/services/route-action.server";
import {
  exportScratchDirectory,
  storageRootsConfig,
} from "@/services/storage-roots";
import {
  enqueueStorageDeleteJob,
  nudgeAfterEnqueue,
  verifyConfine,
} from "@/services/storage-delete-job.server";

const deleteSchema = Schema.Struct({
  /** Plan only: answer what would go, delete nothing (the confirmation). */
  dryRun: Schema.Boolean,
  /** Per-file, from the per-bucket page; absent, the whole bucket. */
  files: Schema.optional(
    Schema.NonEmptyArray(
      Schema.Struct({ location: Schema.String, path: Schema.String })
    )
  ),
  /** The bucket's name as the page shows it: the Job's title only. */
  bucketName: Schema.optional(Schema.String),
});

/**
 * Delete an Other Storage Bucket's files (#2112): the Overlay Render Cache,
 * export scratch, or the Exported Videos of no current Video; the whole
 * bucket or (per-file) the files named. `dryRun`: what would go. Otherwise
 * every refusal is checked again (409) and a `storage-delete` Sidecar Job
 * does the delete (#2157); answers `{ jobId }`. Every other bucket is
 * refused (ADR 0041).
 */
export const action = makeAction({
  input: "json",
  errors: {
    StorageDeleteRefusedError: 409,
    StorageDeleteStartRefusedError: 409,
    UnknownJobKindError: 400,
    NoAttemptsLeftError: 400,
  },
  effect: ({ params, payload }) =>
    Effect.gen(function* () {
      const body = yield* Schema.decodeUnknown(deleteSchema)(payload);
      const db = yield* DrizzleService;
      const roots = yield* storageRootsConfig;
      const bucketId = params.bucketId ?? "";
      const selection = body.files === undefined ? {} : { files: body.files };
      const plan = (alreadyHeld: boolean) =>
        Effect.gen(function* () {
          return yield* deleteOtherStorageBucket({
            db,
            roots,
            bucketId,
            scratchDir: exportScratchDirectory(),
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
          p.deleted.length === 0
            ? "Not deleted: there is nothing to delete"
            : null,
        enqueue: () =>
          enqueueStorageDeleteJob({
            bucketId,
            title: storageDeleteTitle({
              operation: "delete-bucket",
              bucketName: body.bucketName ?? bucketId,
              locationLabel: "",
              ...(body.files === undefined
                ? {}
                : { paths: body.files.map((f) => f.path) }),
            }),
            params: { operation: "delete-bucket", bucketId, ...selection },
          }),
      });
      yield* nudgeAfterEnqueue();
      return started;
    }),
});
