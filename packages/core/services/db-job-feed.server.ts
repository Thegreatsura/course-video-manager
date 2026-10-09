import { asc, desc, eq, gt, inArray, lt, or, sql } from "drizzle-orm";
import { Effect } from "effect";
import { jobEvents, jobs } from "../db/schema.js";
import type { Database } from "./drizzle-service.server.js";
import { makeDbCall } from "./db-job-calls.server.js";
import type { JobEventWithJob } from "./db-job-operations.server.js";

/**
 * The reads behind the Sidecar's Job Event feed (`apps/local/sidecar/job-event-feed.ts`),
 * on the database's clock. Part of `JobOperationsService`.
 */

/** What a subscriber is told about a Job: never its params. */
export const jobSummaryColumns = {
  id: jobs.id,
  kind: jobs.kind,
  title: jobs.title,
  status: jobs.status,
  attempt: jobs.attempt,
  maxAttempts: jobs.maxAttempts,
  subjectType: jobs.subjectType,
  subjectId: jobs.subjectId,
  createdAt: jobs.createdAt,
};

export const createJobFeedOperations = (db: Database) => {
  /**
   * Where a Job Event feed starts reading when its first subscriber arrives:
   * the id of the newest event the database stamped more than `edgeMs` ago
   * (its own clock), so everything after it — the snapshot's edge — is read
   * again. With no event that old, just below the oldest event there is; with
   * no event at all, `null`: start at the first one written.
   */
  const jobEventFeedStart = Effect.fn("jobEventFeedStart")(function* (input: {
    edgeMs: number;
  }) {
    const [older] = yield* makeDbCall(() =>
      db
        .select({ id: jobEvents.id })
        .from(jobEvents)
        .where(
          lt(
            jobEvents.at,
            sql`now() - (${input.edgeMs} * interval '1 millisecond')`
          )
        )
        .orderBy(desc(jobEvents.id))
        .limit(1)
    );
    if (older) return older.id;
    const [oldest] = yield* makeDbCall(() =>
      db
        .select({ id: jobEvents.id })
        .from(jobEvents)
        .orderBy(asc(jobEvents.id))
        .limit(1)
    );
    return oldest ? oldest.id - 1 : null;
  });

  /**
   * One read of a Job Event feed: up to `limit` events with an id above
   * `after` or among `missing` (ids the feed is still waiting on), oldest
   * first, and the database's clock at the read (`nowMs`).
   */
  const readJobEventFeed = Effect.fn("readJobEventFeed")(function* (input: {
    after: number;
    missing: readonly number[];
    limit: number;
  }) {
    const clock = yield* makeDbCall(() =>
      db.execute<{ ms: number }>(
        sql`select (extract(epoch from now()) * 1000)::float8 as ms`
      )
    );
    const newer = gt(jobEvents.id, input.after);
    const rows = yield* makeDbCall(() =>
      db
        .select({ event: jobEvents, job: jobSummaryColumns })
        .from(jobEvents)
        .innerJoin(jobs, eq(jobs.id, jobEvents.jobId))
        .where(
          input.missing.length === 0
            ? newer
            : or(newer, inArray(jobEvents.id, [...input.missing]))
        )
        .orderBy(asc(jobEvents.id))
        .limit(input.limit)
    );
    return {
      rows: rows as JobEventWithJob[],
      /** The database's clock at the read, in epoch ms. */
      nowMs: Number(clock.rows[0]?.ms),
    };
  });

  return { jobEventFeedStart, readJobEventFeed };
};
