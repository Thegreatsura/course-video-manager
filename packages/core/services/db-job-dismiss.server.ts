import { and, asc, inArray, sql } from "drizzle-orm";
import { Effect } from "effect";
import { jobEvents, jobs } from "../db/schema.js";
import type { Database } from "./drizzle-service.server.js";
import { makeDbCall } from "./db-job-calls.server.js";
import type { Job } from "./db-job-operations.server.js";
import { withDbTransaction } from "./with-db-transaction.server.js";

/**
 * The author's **Dismiss**, as a Job Event: a `dismissed` row in `job_event`,
 * never a change to the Job itself, so the queue's state machine is untouched
 * and no migration was needed. Part of `JobOperationsService`.
 */

/** The statuses the author may dismiss: settled, so dismissing cancels nothing. */
const DISMISSABLE_STATUSES: Job["status"][] = [
  "succeeded",
  "failed",
  "interrupted",
];

/** No `dismissed` Job Event: the author has not dismissed this Job. */
export const notDismissed = sql`NOT EXISTS (SELECT 1 FROM ${jobEvents} WHERE ${jobEvents.jobId} = ${jobs.id} AND ${jobEvents.type} = 'dismissed')`;

export const createDismissJobOperations = (db: Database) => {
  /**
   * A `dismissed` Job Event on each SETTLED Job among `jobIds` (succeeded,
   * failed or interrupted) not dismissed already. A Job still queued or
   * running is left alone, and so is an unknown id. The event keeps the Job
   * out of every later snapshot (`listRecentJobs`) and, through the event
   * feed, tells the tabs listening now to drop it. Returns the ids it
   * dismissed.
   */
  const dismissJobs = Effect.fn("dismissJobs")(function* (input: {
    jobIds: readonly string[];
  }) {
    if (input.jobIds.length === 0) return [];
    return yield* withDbTransaction(db, (tx) =>
      Effect.gen(function* () {
        const settled = yield* makeDbCall(() =>
          tx
            .select({ id: jobs.id })
            .from(jobs)
            .where(
              and(
                inArray(jobs.id, [...input.jobIds]),
                inArray(jobs.status, DISMISSABLE_STATUSES),
                notDismissed
              )
            )
            .orderBy(asc(jobs.createdAt), asc(jobs.id))
            .for("update")
        );
        for (const { id } of settled) {
          yield* makeDbCall(() =>
            tx
              .insert(jobEvents)
              .values({ jobId: id, type: "dismissed", data: {} })
          );
        }
        return settled.map((r) => r.id);
      })
    );
  });

  return { dismissJobs };
};
