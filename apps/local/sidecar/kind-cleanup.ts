import { Cause, Effect } from "effect";
import type { Job } from "@cvm/core/services/db-job-operations.server";
import type { EnqueueJob, JobKind } from "./job-kind";

/**
 * What a kind is told once a Job of it has gone wrong for good or been lost:
 * the two hooks a kind may define (`afterLostRun`, `afterFinalFailure`), as
 * the sidecar calls them. A hook that fails is logged; it never stops the
 * sidecar.
 */

const logCause = (what: string) =>
  Effect.catchAllCause((cause: Cause.Cause<unknown>) =>
    Effect.logError(what, cause)
  );

/** The message of a failure as the job table stores it (`error`, jsonb). */
const storedFailureMessage = (error: unknown): string =>
  typeof error === "object" &&
  error !== null &&
  "message" in error &&
  typeof error.message === "string"
    ? error.message
    : "The sidecar running this job stopped before it finished";

export const makeKindCleanup = <R>(opts: {
  readonly kindOf: (name: string) => JobKind<R> | undefined;
  readonly enqueue: EnqueueJob;
}) => {
  const { kindOf, enqueue } = opts;

  /**
   * A run of `job` was lost — not stopped on purpose — and has been
   * settled as a failed attempt: let its kind clean up after it.
   */
  const afterLostRun = (job: { id: string; kind: string; title: string }) => {
    const kind = kindOf(job.kind);
    if (!kind || !("afterLostRun" in kind) || !kind.afterLostRun) {
      return Effect.void;
    }
    return kind
      .afterLostRun({ id: job.id, title: job.title }, { enqueue })
      .pipe(
        Effect.annotateLogs({ jobId: job.id, kind: job.kind }),
        logCause("job: its kind could not clean up after a lost run")
      );
  };

  /**
   * `job` has ended for good (`failed` or `interrupted`), by whatever route:
   * let its kind clean up after it. Every route to a final failure — the
   * sidecar's `settle` and its recovery after a crash — comes here.
   */
  const afterFinalFailure = (
    job: { id: string; kind: string; params: unknown },
    message: string
  ) => {
    const kind = kindOf(job.kind);
    if (!kind || !("afterFinalFailureRaw" in kind)) return Effect.void;
    const hook = kind.afterFinalFailureRaw;
    if (!hook) return Effect.void;
    return hook(job.params, { jobId: job.id, message }).pipe(
      Effect.annotateLogs({ jobId: job.id, kind: job.kind }),
      logCause("job: its kind could not clean up after a final failure")
    );
  };

  /** Whether a settled attempt was the Job's last. */
  const endedForGood = (outcome: string) =>
    outcome === "failed" || outcome === "interrupted";

  /** A Job recovery settled after its sidecar died: both hooks, as they apply. */
  const afterRecovered = (
    job: Pick<Job, "id" | "kind" | "title" | "params" | "error">,
    outcome: string
  ) =>
    afterLostRun(job).pipe(
      Effect.zipRight(
        endedForGood(outcome)
          ? afterFinalFailure(job, storedFailureMessage(job.error))
          : Effect.void
      )
    );

  return { afterLostRun, afterFinalFailure, afterRecovered, endedForGood };
};
