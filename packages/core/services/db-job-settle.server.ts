import { and, eq, sql } from "drizzle-orm";
import { Effect } from "effect";
import { jobEvents, jobs } from "../db/schema.js";
import type { Database } from "./drizzle-service.server.js";
import type { UnknownDBServiceError } from "./db-service-errors.js";
import { dependencyFailure, makeDbCall } from "./db-job-calls.server.js";
import type {
  FailureOutcome,
  Job,
  JobFailure,
} from "./db-job-operations.server.js";

/**
 * Settling a Job that did not succeed, in the caller's transaction: THE RETRY
 * RULE (`settleFailure`) and what it shares with the other job writes. Split
 * out of `db-job-operations.server.ts`, which keeps every caller.
 */

/**
 * How many lost runs of a RESUMABLE kind (a storage move, a Course duplicate)
 * go back in the queue without spending an attempt (#2167). A lost run of one
 * resumes where it was — each file by size — so losing it costs only time,
 * and a long move should outlast Sidecar restarts. The cap stops a Job that
 * itself kills the Sidecar from looping for ever: past it, the retry rule
 * applies again.
 */
export const FREE_LOST_RUNS = 5;

export const insertEvent = (
  handle: Database,
  jobId: string,
  type: string,
  data: Record<string, unknown> = {}
) => makeDbCall(() => handle.insert(jobEvents).values({ jobId, type, data }));

/**
 * Fail every Job still queued behind `parent`, and every Job queued behind
 * those, in the caller's transaction. Each names the Job it was waiting on.
 */
export const failDependents = (
  tx: Database,
  parent: Pick<Job, "id" | "title">
): Effect.Effect<void, UnknownDBServiceError> =>
  Effect.gen(function* () {
    const failure = dependencyFailure(parent.title);
    const doomed = yield* makeDbCall(() =>
      tx
        .update(jobs)
        .set({
          status: "failed",
          error: failure,
          finishedAt: sql`now()`,
          updatedAt: sql`now()`,
        })
        .where(and(eq(jobs.dependsOn, parent.id), eq(jobs.status, "queued")))
        .returning({ id: jobs.id, title: jobs.title })
    );
    for (const child of doomed) {
      yield* insertEvent(tx, child.id, "failed", { error: failure });
      yield* failDependents(tx, child);
    }
  });

/**
 * The retry rule. `job` is locked by the caller's transaction. `mayRetry`
 * false (a posting kind) makes this attempt final whatever the counts say.
 */
export const settleFailure = (
  tx: Database,
  job: Job,
  failure: JobFailure,
  interrupted: boolean,
  mayRetry: boolean,
  resumable = false
): Effect.Effect<FailureOutcome, UnknownDBServiceError> =>
  Effect.gen(function* () {
    if (mayRetry && interrupted && resumable) {
      const [lost] = yield* makeDbCall(() =>
        tx
          .select({ n: sql<number>`count(*)::int` })
          .from(jobEvents)
          .where(
            and(
              eq(jobEvents.jobId, job.id),
              eq(jobEvents.type, "requeued"),
              sql`${jobEvents.data}->>'lost' = 'true'`
            )
          )
      );
      if ((lost?.n ?? 0) < FREE_LOST_RUNS) {
        yield* makeDbCall(() =>
          tx
            .update(jobs)
            .set({
              status: "queued",
              holder: null,
              leaseUntil: null,
              updatedAt: sql`now()`,
            })
            .where(eq(jobs.id, job.id))
        );
        yield* insertEvent(tx, job.id, "requeued", {
          attempt: job.attempt,
          reason: `the run was lost (${failure.cause}); it resumes at the same attempt`,
          lost: true,
        });
        return "requeued" as const;
      }
    }
    if (mayRetry && job.attempt < job.maxAttempts) {
      yield* makeDbCall(() =>
        tx
          .update(jobs)
          .set({
            status: "queued",
            attempt: job.attempt + 1,
            holder: null,
            leaseUntil: null,
            error: failure,
            updatedAt: sql`now()`,
          })
          .where(eq(jobs.id, job.id))
      );
      yield* insertEvent(tx, job.id, "retrying", {
        failedAttempt: job.attempt,
        nextAttempt: job.attempt + 1,
        interrupted,
        error: failure,
      });
      return "retrying" as const;
    }
    const status = interrupted ? "interrupted" : "failed";
    yield* makeDbCall(() =>
      tx
        .update(jobs)
        .set({
          status,
          holder: null,
          leaseUntil: null,
          error: failure,
          finishedAt: sql`now()`,
          updatedAt: sql`now()`,
        })
        .where(eq(jobs.id, job.id))
    );
    yield* insertEvent(tx, job.id, status, {
      attempt: job.attempt,
      error: failure,
    });
    yield* failDependents(tx, job);
    return status;
  });
