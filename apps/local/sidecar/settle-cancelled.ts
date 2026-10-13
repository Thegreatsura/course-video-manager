import { Cause, Effect } from "effect";
import type { JobOperationsService } from "@cvm/core/services/db-job-operations.server";
import { isJobCancelled } from "./job-kind";

/**
 * How the sidecar settles a run that ended on the author's Cancel: the
 * handler cleaned up and failed with `JobCancelledError`, so the Job ends
 * `cancelled`, never retried or failed. `null` for any other ending.
 */
export const settleCancelled = (opts: {
  readonly ops: JobOperationsService;
  readonly jobId: string;
  readonly holder: string;
  readonly cause: Cause.Cause<unknown>;
}) => {
  const failure = Cause.failureOption(opts.cause);
  if (failure._tag !== "Some" || !isJobCancelled(failure.value)) return null;
  return Effect.logInfo("job cancelled by the author").pipe(
    Effect.zipRight(
      opts.ops.cancelJobAttempt({
        jobId: opts.jobId,
        holder: opts.holder,
        message: failure.value.message,
      })
    ),
    Effect.flatMap((held) =>
      Effect.logInfo(`job settled: ${held ? "cancelled" : "not-held"}`)
    )
  );
};
