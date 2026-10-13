import { Config, Effect, Option, type Schema } from "effect";
import { STORAGE_DELETE_JOB_KIND } from "@/packages/storage/client";
import { nudgeSidecar } from "@/services/sidecar-socket.server";
import { VERIFY_RUN_DIR_ENV_KEY } from "@/services/storage-roots";
import { enqueueJob, JOB_KIND_SPECS } from "../../sidecar/job-specs";
import type { JOB_PARAMS } from "../../sidecar/job-params";

export type StorageDeleteJobParams = Schema.Schema.Encoded<
  (typeof JOB_PARAMS)["storage-delete"]
>;

/**
 * Enqueue a `storage-delete` Sidecar Job (#2110, #2157) about one Storage
 * Bucket, nudge the Sidecar, and answer its id: every Storage page delete's
 * last step, once its start has checked every refusal.
 */
export const enqueueStorageDeleteJob = (opts: {
  readonly title: string;
  readonly bucketId: string;
  readonly params: StorageDeleteJobParams;
}) =>
  Effect.gen(function* () {
    const job = yield* enqueueJob({
      id: null,
      kind: STORAGE_DELETE_JOB_KIND,
      title: opts.title,
      params: opts.params,
      subject: { type: "storage-bucket", id: opts.bucketId },
      attemptsSpent: 0,
      dependsOn: null,
      registry: JOB_KIND_SPECS,
    });
    return { jobId: job.id };
  });

/** Nudge the Sidecar once a Job is queued, so a lane picks it up now. */
export const nudgeAfterEnqueue = nudgeSidecar;

/** A verify-cvm run deletes only inside its own directory. */
export const verifyConfine = Effect.gen(function* () {
  const dir = yield* Config.option(Config.string(VERIFY_RUN_DIR_ENV_KEY));
  return Option.match(dir, {
    onNone: () => ({}),
    onSome: (d) => (d.trim() === "" ? {} : { confineTo: d }),
  });
});
