import { Effect, Schema } from "effect";
import {
  emptyStorageTrash,
  listStorageTrash,
  restoreTrashedFootage,
  trashUnusedFootage,
} from "@/packages/storage/trash";
import { startStorageDelete } from "@/packages/storage/delete";
import {
  storageDeleteTitle,
  trashDoneFiles,
  type StorageTrashResult,
} from "@/packages/storage/client";
import { DrizzleService } from "@/services/drizzle-service.server";
import { makeAction, makeLoader } from "@/services/route-action.server";
import { storageRootsConfig } from "@/services/storage-roots";
import {
  enqueueStorageDeleteJob,
  nudgeAfterEnqueue,
  verifyConfine,
} from "@/services/storage-delete-job.server";

/**
 * What is in the Trash (#2157, ADR 0043), on every reachable Storage Root:
 * each trashed file, when it went, and when it is deleted for good. Reads
 * only the `.cvm-trash/` folders.
 */
export const loader = makeLoader({
  effect: () =>
    Effect.gen(function* () {
      const roots = yield* storageRootsConfig;
      return { entries: yield* listStorageTrash({ roots }) };
    }),
});

const FileAt = Schema.Struct({ location: Schema.String, path: Schema.String });

const TrashRequest = Schema.Union(
  Schema.Struct({
    operation: Schema.Literal("trash-unused"),
    dryRun: Schema.Boolean,
    /** Per-file; absent, all Unused Footage. */
    files: Schema.optional(Schema.NonEmptyArray(FileAt)),
  }),
  Schema.Struct({
    operation: Schema.Literal("restore-trash"),
    dryRun: Schema.Boolean,
    files: Schema.NonEmptyArray(
      Schema.Struct({
        location: Schema.String,
        batch: Schema.String,
        path: Schema.String,
      })
    ),
  }),
  Schema.Struct({
    operation: Schema.Literal("empty-trash"),
    dryRun: Schema.Boolean,
  })
);

/**
 * The Trash's actions (#2157): move Unused Footage to the Trash, Restore,
 * or Empty trash. `dryRun`: what would be done and what is kept, and why.
 * Otherwise every refusal is checked again (409) and a `storage-delete`
 * Sidecar Job does it; answers `{ jobId }`. Nothing is moved in this request.
 */
export const action = makeAction({
  input: "json",
  errors: {
    StorageTrashRefusedError: 409,
    StorageDeleteStartRefusedError: 409,
    UnknownJobKindError: 400,
    NoAttemptsLeftError: 400,
  },
  effect: ({ payload }) =>
    Effect.gen(function* () {
      const request = yield* Schema.decodeUnknown(TrashRequest)(payload);
      const db = yield* DrizzleService;
      const roots = yield* storageRootsConfig;
      const confine = yield* verifyConfine;
      const common = { db, roots, dryRun: true, ...confine };
      const plan = (alreadyHeld: boolean) => {
        switch (request.operation) {
          case "trash-unused":
            return trashUnusedFootage({
              ...common,
              alreadyHeld,
              ...(request.files === undefined ? {} : { files: request.files }),
            });
          case "restore-trash":
            return restoreTrashedFootage({
              ...common,
              alreadyHeld,
              files: request.files,
            });
          case "empty-trash":
            return emptyStorageTrash({ ...common, alreadyHeld });
        }
      };
      if (request.dryRun) return yield* plan(false);
      const paths =
        request.operation === "empty-trash"
          ? undefined
          : request.files?.map((f) => f.path);
      const started = yield* startStorageDelete({
        plan: plan(true),
        nothingToDo: (p: StorageTrashResult) =>
          trashDoneFiles(p) === 0 ? "Nothing to do: no file qualifies" : null,
        enqueue: () =>
          enqueueStorageDeleteJob({
            bucketId: "unused-footage",
            title: storageDeleteTitle({
              operation: request.operation,
              bucketName: "Unused Footage",
              locationLabel: "",
              ...(paths === undefined ? {} : { paths }),
            }),
            params:
              request.operation === "empty-trash"
                ? { operation: "empty-trash" }
                : request.operation === "restore-trash"
                  ? { operation: "restore-trash", files: request.files }
                  : {
                      operation: "trash-unused",
                      ...(request.files === undefined
                        ? {}
                        : { files: request.files }),
                    },
          }),
      });
      yield* nudgeAfterEnqueue();
      return started;
    }),
});
