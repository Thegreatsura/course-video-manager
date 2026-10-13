import { and, eq, sql } from "drizzle-orm";
import { Effect } from "effect";
import { jobEvents, jobs } from "../db/schema.js";
import type { Database } from "./drizzle-service.server.js";
import type { UnknownDBServiceError } from "./db-service-errors.js";
import { makeDbCall } from "./db-job-calls.server.js";
import { withDbTransaction } from "./with-db-transaction.server.js";

/**
 * The author asked a running Job to stop (`requestJobCancel`). Its handler
 * looks for it between steps; once it has cleaned up, the Job ends
 * `cancelled`.
 */
export const CANCEL_REQUESTED_EVENT = "cancel-requested";

type Job = typeof jobs.$inferSelect;

/**
 * Cancel (#2109), the first use of the `cancelled` status. Part of
 * `createJobOperations`, which hands in its `failDependents`.
 */
export const createCancelJobOperations = (
  db: Database,
  deps: {
    readonly failDependents: (
      tx: Database,
      parent: Pick<Job, "id" | "title">
    ) => Effect.Effect<void, UnknownDBServiceError>;
  }
) => {
  const { failDependents } = deps;
  const insertEvent = (
    handle: Database,
    jobId: string,
    type: string,
    data: Record<string, unknown> = {}
  ) => makeDbCall(() => handle.insert(jobEvents).values({ jobId, type, data }));

  const lockHeld = (tx: Database, jobId: string, holder: string) =>
    makeDbCall(() =>
      tx
        .select()
        .from(jobs)
        .where(
          and(
            eq(jobs.id, jobId),
            eq(jobs.status, "running"),
            eq(jobs.holder, holder)
          )
        )
        .for("update")
    ).pipe(Effect.map((rows) => rows[0]));

  /**
   * The author's Cancel. A queued Job is never run: it ends `cancelled` here,
   * and every Job queued behind it fails. A running Job is asked to stop with
   * a `cancel-requested` Job Event: its handler looks for that between steps
   * (`isJobCancelRequested`), cleans up after itself, and ends the attempt
   * `cancelled` (`cancelJobAttempt`). Only kinds the caller names in `kinds`
   * can be cancelled; a finished Job is left as it is.
   */
  const requestJobCancel = Effect.fn("requestJobCancel")(function* (input: {
    jobId: string;
    kinds: readonly string[];
  }) {
    return yield* withDbTransaction(db, (tx) =>
      Effect.gen(function* () {
        const [job] = yield* makeDbCall(() =>
          tx.select().from(jobs).where(eq(jobs.id, input.jobId)).for("update")
        );
        if (!job) return { outcome: "not-found" as const };
        if (!input.kinds.includes(job.kind)) {
          return { outcome: "not-cancellable" as const, job };
        }
        if (job.status === "queued") {
          yield* makeDbCall(() =>
            tx
              .update(jobs)
              .set({
                status: "cancelled",
                holder: null,
                leaseUntil: null,
                finishedAt: sql`now()`,
                updatedAt: sql`now()`,
              })
              .where(eq(jobs.id, job.id))
          );
          yield* insertEvent(tx, job.id, "cancelled", {
            attempt: job.attempt,
            ran: false,
          });
          yield* failDependents(tx, job);
          return { outcome: "cancelled" as const, job };
        }
        if (job.status === "running") {
          const [already] = yield* makeDbCall(() =>
            tx
              .select({ id: jobEvents.id })
              .from(jobEvents)
              .where(
                and(
                  eq(jobEvents.jobId, job.id),
                  eq(jobEvents.type, CANCEL_REQUESTED_EVENT)
                )
              )
              .limit(1)
          );
          if (!already) {
            yield* insertEvent(tx, job.id, CANCEL_REQUESTED_EVENT, {
              attempt: job.attempt,
            });
          }
          return { outcome: "requested" as const, job };
        }
        return { outcome: "finished" as const, job };
      })
    );
  });

  /** Whether the author has asked this Job to stop (`requestJobCancel`). */
  const isJobCancelRequested = Effect.fn("isJobCancelRequested")(function* (
    jobId: string
  ) {
    const [row] = yield* makeDbCall(() =>
      db
        .select({ id: jobEvents.id })
        .from(jobEvents)
        .where(
          and(
            eq(jobEvents.jobId, jobId),
            eq(jobEvents.type, CANCEL_REQUESTED_EVENT)
          )
        )
        .limit(1)
    );
    return row !== undefined;
  });

  /**
   * End a held Job `cancelled`: its handler stopped on the author's Cancel and
   * cleaned up. Final, whatever its attempts; every Job queued behind it
   * fails. `false` when the Job was no longer `holder`'s.
   */
  const cancelJobAttempt = Effect.fn("cancelJobAttempt")(function* (input: {
    jobId: string;
    holder: string;
    message: string;
  }) {
    return yield* withDbTransaction(db, (tx) =>
      Effect.gen(function* () {
        const job = yield* lockHeld(tx, input.jobId, input.holder);
        if (!job) return false;
        yield* makeDbCall(() =>
          tx
            .update(jobs)
            .set({
              status: "cancelled",
              holder: null,
              leaseUntil: null,
              finishedAt: sql`now()`,
              updatedAt: sql`now()`,
            })
            .where(eq(jobs.id, job.id))
        );
        yield* insertEvent(tx, job.id, "cancelled", {
          attempt: job.attempt,
          ran: true,
          message: input.message,
        });
        yield* failDependents(tx, job);
        return true;
      })
    );
  });

  return { requestJobCancel, isJobCancelRequested, cancelJobAttempt };
};
