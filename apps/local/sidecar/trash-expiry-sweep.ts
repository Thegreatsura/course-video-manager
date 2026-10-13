import { Effect } from "effect";
import { DrizzleService } from "@/services/drizzle-service.server";
import { storageRootsConfig } from "@/services/storage-roots";
import { emptyStorageTrash, trashHasExpired } from "@/packages/storage/trash";
import {
  STORAGE_DELETE_JOB_KIND,
  storageDeleteTitle,
  trashDoneFiles,
} from "@/packages/storage/client";
import { enqueueJob, JOB_KIND_SPECS } from "./job-specs";

/** How often the sweep looks at the Trash: never more than hourly. */
export const TRASH_EXPIRY_EVERY_MS = 60 * 60 * 1000;

let lastLooked = 0;

/**
 * THE TRASH EXPIRY SWEEP (#2157, ADR 0043): Trash older than 14 days is
 * deleted for good. At most once an hour (it lists each Storage Root's
 * `.cvm-trash/`, a USB drive's too), it checks for an expired batch; if one
 * is there and nothing refuses (no export, move, delete, transcription or
 * recording is live), it queues an `expire-trash` `storage-delete` Job,
 * which shows in the Upload Manager like any other delete. It deletes
 * nothing itself.
 */
export const sweepExpiredTrash = Effect.gen(function* () {
  const now = Date.now();
  if (now - lastLooked < TRASH_EXPIRY_EVERY_MS) return;
  lastLooked = now;
  const roots = yield* storageRootsConfig;
  if (!(yield* trashHasExpired({ roots }))) return;
  const db = yield* DrizzleService;
  const plan = yield* emptyStorageTrash({
    db,
    roots,
    olderThanRetention: true,
    dryRun: true,
  });
  if (trashDoneFiles(plan) === 0) return;
  const job = yield* enqueueJob({
    id: null,
    kind: STORAGE_DELETE_JOB_KIND,
    title: storageDeleteTitle({
      operation: "expire-trash",
      bucketName: "Unused Footage",
      locationLabel: "",
    }),
    params: { operation: "expire-trash" },
    subject: { type: "storage-bucket", id: "unused-footage" },
    attemptsSpent: 0,
    dependsOn: null,
    registry: JOB_KIND_SPECS,
  });
  yield* Effect.logInfo("trash expiry: queued", { jobId: job.id });
}).pipe(
  // A refusal (something is running) or an Offline drive: try next hour.
  Effect.catchAllCause((cause) =>
    Effect.logWarning("trash expiry: not queued this time", cause)
  )
);

/** For tests: forget when the sweep last looked. */
export const resetTrashExpirySweep = () => {
  lastLooked = 0;
};
