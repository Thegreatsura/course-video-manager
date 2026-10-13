import { Effect, Schema } from "effect";
import { startStorageMove } from "@/packages/storage/move";
import {
  STORAGE_MOVE_JOB_KIND,
  STORAGE_MOVE_KINDS,
  storageMoveTitle,
} from "@/packages/storage/client";
import { DrizzleService } from "@/services/drizzle-service.server";
import { makeAction } from "@/services/route-action.server";
import { nudgeSidecar } from "@/services/sidecar-socket.server";
import { storageRootsConfig } from "@/services/storage-roots";
import { enqueueJob, JOB_KIND_SPECS } from "../../sidecar/job-specs";

const MoveRequest = Schema.Struct({
  kind: Schema.Literal(...STORAGE_MOVE_KINDS),
  target: Schema.String,
});

/**
 * Start moving a Storage Bucket's files to another Storage Root (#2109): the
 * Storage page's confirmed move. Every refusal is checked again here (409,
 * naming each) — a Purge or delete under way included — and once more when
 * the Sidecar starts the `storage-move` Job, which does the copy
 * (`sidecar/kinds/storage-move.ts`). Answers the Job's id; its row in the
 * Upload Manager shows the progress, and has a Cancel.
 */
export const action = makeAction({
  input: "json",
  errors: {
    StorageMoveRefusedError: 409,
    UnknownJobKindError: 400,
    NoAttemptsLeftError: 400,
  },
  effect: ({ params, payload }) =>
    Effect.gen(function* () {
      const request = yield* Schema.decodeUnknown(MoveRequest)(payload);
      const db = yield* DrizzleService;
      const roots = yield* storageRootsConfig;
      const bucketId = params.bucketId ?? "";
      const job = yield* startStorageMove({
        db,
        roots,
        bucketId,
        kind: request.kind,
        target: request.target,
        enqueue: (plan) =>
          enqueueJob({
            id: null,
            kind: STORAGE_MOVE_JOB_KIND,
            title: storageMoveTitle(
              plan.bucketName,
              plan.kind,
              plan.targetLabel
            ),
            params: { bucketId, kind: request.kind, target: request.target },
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
