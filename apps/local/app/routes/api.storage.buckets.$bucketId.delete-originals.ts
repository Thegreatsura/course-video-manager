import { Effect, Schema } from "effect";
import { rootLabel } from "@/packages/storage";
import { startDeleteOriginals } from "@/packages/storage/originals";
import {
  STORAGE_DELETE_JOB_KIND,
  storageDeleteTitle,
} from "@/packages/storage/client";
import { DrizzleService } from "@/services/drizzle-service.server";
import { makeAction } from "@/services/route-action.server";
import { nudgeSidecar } from "@/services/sidecar-socket.server";
import { storageRootsConfig } from "@/services/storage-roots";
import { enqueueJob, JOB_KIND_SPECS } from "../../sidecar/job-specs";

const DeleteOriginalsRequest = Schema.Struct({
  /** The Storage Root to delete the originals from. */
  from: Schema.String,
  /** Per-file (#2157): only these files (root-relative). */
  paths: Schema.optional(Schema.NonEmptyArray(Schema.String)),
});

/**
 * Start "Delete originals" (#2110): the per-bucket page's confirmed delete.
 * The refusals that need no drive are checked here (409), then the
 * `storage-delete` Sidecar Job is enqueued, which checks the rest, walks the
 * files and checks each against its copy by checksum before deleting it
 * (`sidecar/kinds/storage-delete.ts`). No drive is read and nothing is
 * deleted in this request, so it answers at once (#2429).
 * Answers the Job's id; its row in the Upload Manager shows the progress, a
 * Cancel, and the result ("N files still on D:, retry").
 */
export const action = makeAction({
  input: "json",
  errors: {
    StorageOriginalsRefusedError: 409,
    UnknownJobKindError: 400,
    NoAttemptsLeftError: 400,
  },
  effect: ({ params, payload }) =>
    Effect.gen(function* () {
      const request = yield* Schema.decodeUnknown(DeleteOriginalsRequest)(
        payload
      );
      const db = yield* DrizzleService;
      const roots = yield* storageRootsConfig;
      const bucketId = params.bucketId ?? "";
      const job = yield* startDeleteOriginals({
        db,
        roots,
        bucketId,
        from: request.from,
        ...(request.paths === undefined ? {} : { paths: request.paths }),
        enqueue: ({ bucketName }) =>
          enqueueJob({
            id: null,
            kind: STORAGE_DELETE_JOB_KIND,
            title: storageDeleteTitle({
              operation: "originals",
              bucketName,
              locationLabel: rootLabel(request.from),
              ...(request.paths === undefined ? {} : { paths: request.paths }),
            }),
            params: {
              operation: "originals",
              bucketId,
              from: request.from,
              ...(request.paths === undefined ? {} : { paths: request.paths }),
            },
            subject: { type: "storage-bucket", id: bucketId },
            attemptsSpent: 0,
            dependsOn: null,
            registry: JOB_KIND_SPECS,
          }),
      });
      yield* nudgeSidecar();
      return { jobId: job.id };
    }),
});
