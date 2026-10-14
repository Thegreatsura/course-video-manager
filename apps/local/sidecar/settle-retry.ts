import { Duration, Effect, Schedule } from "effect";
import type { JobOperationsService } from "@cvm/core/services/db-job-operations.server";

/**
 * The writes that record how a run ended, retried through a short database
 * outage (#2168). On 2026-10-13 a ~40 s DNS blip failed `returnJobToQueue`
 * once; nothing tried again, the Job's lease lapsed, and recovery spent the
 * last attempt of a 111 GB storage move that had only been stopped.
 *
 * Each write is a transaction that first checks this sidecar still holds the
 * Job (`lockHeld`), so trying again is safe: a write that did land answers
 * `not-held`/`false` the second time and changes nothing. Tries go on, with
 * backoff, for up to `windowMs` — one Job lease (`jobLeaseMs`): past that,
 * recovery may already have settled the Job, and it is recovery's to settle.
 */
export type SettleOps = Pick<
  JobOperationsService,
  "completeJob" | "failJobAttempt" | "returnJobToQueue" | "cancelJobAttempt"
>;

export const retryingSettleOps = <O extends SettleOps>(
  ops: O,
  windowMs: number
): O => {
  const retry = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.tapError((error) =>
        Effect.logWarning(
          "job: could not record how it ended yet; trying again",
          error
        )
      ),
      Effect.retry(
        Schedule.exponential(Duration.millis(250)).pipe(
          Schedule.either(Schedule.spaced(Duration.seconds(5))),
          Schedule.upTo(Duration.millis(windowMs))
        )
      )
    );
  return {
    ...ops,
    completeJob: (input) => retry(ops.completeJob(input)),
    failJobAttempt: (input) => retry(ops.failJobAttempt(input)),
    returnJobToQueue: (input) => retry(ops.returnJobToQueue(input)),
    cancelJobAttempt: (input) => retry(ops.cancelJobAttempt(input)),
  };
};
