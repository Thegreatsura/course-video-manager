import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";
import { Effect } from "effect";
import { jobEvents, jobs } from "../db/schema.js";
import type { Database } from "./drizzle-service.server.js";
import { makeDbCall } from "./db-job-calls.server.js";
import type { Job } from "./db-job-operations.server.js";
import { withDbTransaction } from "./with-db-transaction.server.js";

/**
 * The statements only a POSTING Job needs (decision 5 in
 * docs/plans/background-jobs-sidecar.md): the author's Retry, the one way a
 * post runs again, and the list of interrupted posts nobody has looked for.
 * Part of `JobOperationsService`.
 */
export const createPostingJobOperations = (db: Database) => {
  const insertEvent = (
    handle: Database,
    jobId: string,
    type: string,
    data: Record<string, unknown>
  ) => makeDbCall(() => handle.insert(jobEvents).values({ jobId, type, data }));

  /**
   * The author's Retry: run a finished, unsuccessful Job ONE more time. The
   * same row goes back to `queued` as `attempt + 1`, with `max_attempts` set
   * to that attempt, so this run is its last unless the author retries again.
   * Refused when the Job is not finished-and-unsuccessful, or when the Job it
   * waits on has not succeeded (it would wait for ever).
   */
  const retryJob = Effect.fn("retryJob")(function* (input: { jobId: string }) {
    return yield* withDbTransaction(db, (tx) =>
      Effect.gen(function* () {
        const [job] = yield* makeDbCall(() =>
          tx.select().from(jobs).where(eq(jobs.id, input.jobId)).for("update")
        );
        if (!job) return { outcome: "not-found" as const };
        if (job.status !== "failed" && job.status !== "interrupted") {
          return { outcome: "not-retryable" as const, job };
        }
        if (job.dependsOn) {
          const [parent] = yield* makeDbCall(() =>
            tx
              .select({ status: jobs.status, title: jobs.title })
              .from(jobs)
              .where(eq(jobs.id, job.dependsOn ?? ""))
          );
          if (parent && parent.status !== "succeeded") {
            return {
              outcome: "dependency-not-succeeded" as const,
              job,
              dependency: parent.title,
            };
          }
        }
        const attempt = job.attempt + 1;
        const [retried] = yield* makeDbCall(() =>
          tx
            .update(jobs)
            .set({
              status: "queued",
              attempt,
              maxAttempts: attempt,
              holder: null,
              leaseUntil: null,
              startedAt: null,
              finishedAt: null,
              updatedAt: sql`now()`,
            })
            .where(eq(jobs.id, job.id))
            .returning()
        );
        yield* insertEvent(tx, job.id, "queued", {
          kind: job.kind,
          lane: job.lane,
          dependsOn: job.dependsOn,
          attempt,
          retriedBy: "author",
        });
        return { outcome: "queued" as const, job: retried ?? job };
      })
    );
  });

  /**
   * Interrupted Jobs of `kinds` that finished in the last `finishedWithinMs`
   * and have no `eventType` event yet: the posts nobody has looked for.
   */
  const listInterruptedJobsWithoutEvent = Effect.fn(
    "listInterruptedJobsWithoutEvent"
  )(function* (input: {
    kinds: readonly string[];
    eventType: string;
    finishedWithinMs: number;
  }) {
    if (input.kinds.length === 0) return [] as Job[];
    return yield* makeDbCall(() =>
      db
        .select()
        .from(jobs)
        .where(
          and(
            eq(jobs.status, "interrupted"),
            inArray(jobs.kind, [...input.kinds]),
            gt(
              jobs.finishedAt,
              sql`now() - (${input.finishedWithinMs} * interval '1 millisecond')`
            ),
            sql`NOT EXISTS (SELECT 1 FROM ${jobEvents} e
                             WHERE e.job_id = ${jobs.id}
                               AND e.type = ${input.eventType}
                               AND e.at >= ${jobs.finishedAt})`
          )
        )
        .orderBy(asc(jobs.finishedAt))
    );
  });

  return { retryJob, listInterruptedJobsWithoutEvent };
};
