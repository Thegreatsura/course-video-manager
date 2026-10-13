import { Data, Effect } from "effect";
import { JobOperationsService } from "@cvm/core/services/db-job-operations.server";
import { makeAction } from "@/services/route-action.server";
import { nudgeSidecar } from "@/services/sidecar-socket.server";
import { CANCELLABLE_JOB_KINDS } from "../../sidecar/job-specs";

class JobNotCancellableError extends Data.TaggedError(
  "JobNotCancellableError"
)<{ readonly message: string }> {}

class JobToCancelNotFoundError extends Data.TaggedError(
  "JobToCancelNotFoundError"
)<{ readonly message: string }> {}

/**
 * The author's **Cancel** on a Job's row (#2109): only a kind that cleans up
 * after itself offers one (`CANCELLABLE_JOB_KINDS`: a Storage move). A queued
 * Job ends `cancelled` at once; a running one is asked to stop, and ends
 * `cancelled` once it has removed its partial copies. A finished Job is left
 * as it is.
 */
export const action = makeAction({
  input: "none",
  errors: { JobNotCancellableError: 409, JobToCancelNotFoundError: 404 },
  effect: ({ params }) =>
    Effect.gen(function* () {
      const ops = yield* JobOperationsService;
      const jobId = params.jobId ?? "";
      const result = yield* ops.requestJobCancel({
        jobId,
        kinds: CANCELLABLE_JOB_KINDS,
      });
      switch (result.outcome) {
        case "not-found":
          return yield* new JobToCancelNotFoundError({
            message: `no job ${jobId}`,
          });
        case "not-cancellable":
          return yield* new JobNotCancellableError({
            message: `a ${result.job.kind} Job can't be cancelled`,
          });
        case "finished":
          return { id: jobId, outcome: "finished" as const };
        case "cancelled":
        case "requested":
          yield* nudgeSidecar();
          return { id: jobId, outcome: result.outcome };
      }
    }),
});
