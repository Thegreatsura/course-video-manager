import { Effect, Schema } from "effect";
import { deleteUnusedFootage } from "@/packages/storage/unused";
import { startStorageDelete } from "@/packages/storage/delete";
import {
  storageDeleteTitle,
  unusedDeletedFiles,
  type StorageUnusedDeleteResult,
} from "@/packages/storage/client";
import { DrizzleService } from "@/services/drizzle-service.server";
import { makeAction } from "@/services/route-action.server";
import { storageRootsConfig } from "@/services/storage-roots";
import {
  enqueueStorageDeleteJob,
  nudgeAfterEnqueue,
  verifyConfine,
} from "@/services/storage-delete-job.server";

const FileAt = Schema.Struct({ location: Schema.String, path: Schema.String });

const UnusedDeleteRequest = Schema.Struct({
  dryRun: Schema.Boolean,
  /** Per-file; absent, all Unused Footage. */
  files: Schema.optional(Schema.NonEmptyArray(FileAt)),
});

/**
 * Delete Unused Footage for good (#2157, #2423; there is no trash).
 * `dryRun`: what would be deleted and what is kept, and why. Otherwise every
 * refusal is checked again (409) and a `storage-delete` Sidecar Job does
 * it; answers `{ jobId }`. Nothing is deleted in this request.
 */
export const action = makeAction({
  input: "json",
  errors: {
    StorageUnusedDeleteRefusedError: 409,
    StorageDeleteStartRefusedError: 409,
    UnknownJobKindError: 400,
    NoAttemptsLeftError: 400,
  },
  effect: ({ payload }) =>
    Effect.gen(function* () {
      const request = yield* Schema.decodeUnknown(UnusedDeleteRequest)(payload);
      const db = yield* DrizzleService;
      const roots = yield* storageRootsConfig;
      const confine = yield* verifyConfine;
      const files = request.files === undefined ? {} : { files: request.files };
      const plan = (alreadyHeld: boolean) =>
        deleteUnusedFootage({
          db,
          roots,
          dryRun: true,
          ...confine,
          alreadyHeld,
          ...files,
        });
      if (request.dryRun) return yield* plan(false);
      const paths = request.files?.map((f) => f.path);
      const started = yield* startStorageDelete({
        plan: plan(true),
        nothingToDo: (p: StorageUnusedDeleteResult) =>
          unusedDeletedFiles(p) === 0
            ? "Nothing to do: no file qualifies"
            : null,
        enqueue: () =>
          enqueueStorageDeleteJob({
            bucketId: "unused-footage",
            title: storageDeleteTitle({
              operation: "delete-unused",
              bucketName: "Unused Footage",
              locationLabel: "",
              ...(paths === undefined ? {} : { paths }),
            }),
            params: { operation: "delete-unused", ...files },
          }),
      });
      yield* nudgeAfterEnqueue();
      return started;
    }),
});
