import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  lt,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import { Effect } from "effect";
import { jobEvents, jobs, sidecarLease } from "../db/schema.js";
import { DrizzleService, type Database } from "./drizzle-service.server.js";
import { UnknownDBServiceError } from "./db-service-errors.js";
import { withDbTransaction } from "./with-db-transaction.server.js";
import { createPostingJobOperations } from "./db-job-posting.server.js";
export { POSTED_EVENT, POST_CHECK_EVENT } from "./db-job-posting.server.js";
import {
  createDismissJobOperations,
  notDismissed,
} from "./db-job-dismiss.server.js";
import { dependencyFailure, makeDbCall } from "./db-job-calls.server.js";
import { createEnqueueJobOperations } from "./db-job-enqueue.server.js";
import {
  createJobFeedOperations,
  jobSummaryColumns,
} from "./db-job-feed.server.js";
export { dependencyFailedMessage } from "./db-job-calls.server.js";

/**
 * Every statement against the background-job tables (`db/schema-jobs.ts`).
 * The Sidecar (`apps/local/sidecar/`) is the only caller that claims, settles
 * or leases; anything may enqueue and read.
 *
 * Time is the DATABASE's clock (`now()`) throughout, so a lease taken by one
 * process is judged by the same clock in every other.
 *
 * THE RETRY RULE lives here, once (`settleFailure`): a failed or interrupted
 * attempt goes back to `queued` as `attempt + 1` while `attempt < max_attempts`,
 * and is final otherwise — and ALWAYS final for a kind the caller names as
 * one that must never run again on its own (a posting kind: Matt's decision
 * 5). Only `retryJob`, the author's Retry, runs such a Job again. A Job that ends any way but `succeeded` fails every
 * Job still queued behind it. Both copy the Upload Manager — see
 * docs/plans/background-jobs-sidecar.md, "What the sidecar copies".
 */

export type Job = typeof jobs.$inferSelect;
export type JobEvent = typeof jobEvents.$inferSelect;
export type SidecarLease = typeof sidecarLease.$inferSelect;

/** What a subscriber needs to know about a Job to show it: never its params. */
export interface JobSummary {
  readonly id: string;
  readonly kind: string;
  readonly title: string;
  readonly status: Job["status"];
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly subjectType: string | null;
  readonly subjectId: string | null;
  readonly createdAt: Date;
}

/** A Job Event as a subscriber receives it: with the Job it belongs to. */
export interface JobEventWithJob {
  readonly event: JobEvent;
  readonly job: JobSummary;
}

/** What `job.error` holds: enough to diagnose without the log. */
export interface JobFailure {
  /** The error's `_tag`, when it had one. */
  readonly tag: string | null;
  /** One line, for a toast or a row. */
  readonly message: string;
  /** The whole cause chain, as `formatFailureCause` or `Cause.pretty` wrote it. */
  readonly cause: string;
}

/** What became of an attempt that did not succeed. */
export type FailureOutcome =
  | "retrying"
  | "failed"
  | "interrupted"
  /** The Job was no longer this holder's to settle (recovered, or finished). */
  | "not-held";

const leaseEnd = (leaseMs: number) =>
  sql`now() + (${leaseMs} * interval '1 millisecond')`;

/**
 * What a cut-off post says, on its row and in its toast: it may or may not
 * have gone out, and nothing will run it again until the author says so.
 */
export const INTERRUPTED_POST_MESSAGE =
  "Interrupted — check before retrying: the post was cut off, so it may or may not have gone out";

export const createJobOperations = (db: Database) => {
  const insertEvent = (
    handle: Database,
    jobId: string,
    type: string,
    data: Record<string, unknown> = {}
  ) => makeDbCall(() => handle.insert(jobEvents).values({ jobId, type, data }));

  /**
   * Fail every Job still queued behind `parent`, and every Job queued behind
   * those, in the caller's transaction. Each names the Job it was waiting on.
   */
  const failDependents = (
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
  const settleFailure = (
    tx: Database,
    job: Job,
    failure: JobFailure,
    interrupted: boolean,
    mayRetry: boolean
  ): Effect.Effect<FailureOutcome, UnknownDBServiceError> =>
    Effect.gen(function* () {
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

  /** The running Job `jobId`, locked, if `holder` still holds it. */
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

  // -- Jobs ------------------------------------------------------------------

  /**
   * Claim the oldest queued Job in `lane` whose dependency (if any) has
   * succeeded: one statement, `FOR UPDATE SKIP LOCKED`, so two claimers never
   * take the same row. `undefined` when there is nothing to run.
   */
  const claimNextJob = Effect.fn("claimNextJob")(function* (input: {
    lane: string;
    holder: string;
    leaseMs: number;
  }) {
    return yield* withDbTransaction(db, (tx) =>
      Effect.gen(function* () {
        const [job] = yield* makeDbCall(() =>
          tx
            .update(jobs)
            .set({
              status: "running",
              holder: input.holder,
              leaseUntil: leaseEnd(input.leaseMs),
              startedAt: sql`now()`,
              updatedAt: sql`now()`,
            })
            .where(
              eq(
                jobs.id,
                sql`(SELECT q.id FROM ${jobs} q
                       LEFT JOIN ${jobs} p ON p.id = q.depends_on
                      WHERE q.status = 'queued' AND q.lane = ${input.lane}
                        AND (q.depends_on IS NULL OR p.status = 'succeeded')
                      ORDER BY q.created_at, q.id
                      LIMIT 1
                      FOR UPDATE OF q SKIP LOCKED)`
              )
            )
            .returning()
        );
        if (!job) return undefined;
        yield* insertEvent(tx, job.id, "started", {
          attempt: job.attempt,
          maxAttempts: job.maxAttempts,
          holder: input.holder,
        });
        return job;
      })
    );
  });

  /** Extend the lease on each Job `holder` still runs; returns the ids it still holds. */
  const heartbeatJobs = Effect.fn("heartbeatJobs")(function* (input: {
    holder: string;
    jobIds: readonly string[];
    leaseMs: number;
  }) {
    if (input.jobIds.length === 0) return [] as string[];
    const rows = yield* makeDbCall(() =>
      db
        .update(jobs)
        .set({ leaseUntil: leaseEnd(input.leaseMs), updatedAt: sql`now()` })
        .where(
          and(
            inArray(jobs.id, [...input.jobIds]),
            eq(jobs.status, "running"),
            eq(jobs.holder, input.holder)
          )
        )
        .returning({ id: jobs.id })
    );
    return rows.map((r) => r.id);
  });

  const appendJobEvent = Effect.fn("appendJobEvent")(function* (input: {
    jobId: string;
    type: string;
    data: Record<string, unknown>;
  }) {
    yield* insertEvent(db, input.jobId, input.type, input.data);
  });

  /** Mark a held Job succeeded. `false` when it was no longer `holder`'s. */
  const completeJob = Effect.fn("completeJob")(function* (input: {
    jobId: string;
    holder: string;
  }) {
    return yield* withDbTransaction(db, (tx) =>
      Effect.gen(function* () {
        const job = yield* lockHeld(tx, input.jobId, input.holder);
        if (!job) return false;
        yield* makeDbCall(() =>
          tx
            .update(jobs)
            .set({
              status: "succeeded",
              holder: null,
              leaseUntil: null,
              finishedAt: sql`now()`,
              updatedAt: sql`now()`,
            })
            .where(eq(jobs.id, job.id))
        );
        yield* insertEvent(tx, job.id, "succeeded", { attempt: job.attempt });
        return true;
      })
    );
  });

  /**
   * Settle a held Job's failed (or interrupted) attempt by the retry rule.
   * `mayRetry: false` (a posting kind) ends it here, whatever its attempts.
   */
  const failJobAttempt = Effect.fn("failJobAttempt")(function* (input: {
    jobId: string;
    holder: string;
    failure: JobFailure;
    interrupted: boolean;
    mayRetry: boolean;
  }) {
    return yield* withDbTransaction(db, (tx) =>
      Effect.gen(function* () {
        const job = yield* lockHeld(tx, input.jobId, input.holder);
        if (!job) return "not-held" as const;
        return yield* settleFailure(
          tx,
          job,
          input.failure,
          input.interrupted,
          input.mayRetry
        );
      })
    );
  });

  /**
   * Put a held Job back in the queue at the SAME attempt, because its sidecar
   * is stopping on purpose (a signal: `tsx watch` restarting it after an
   * edit, Ctrl-C, verify-cvm's cleanup). A deliberate stop is not a failure
   * of the Job, so it spends no attempt; a sidecar that DIES is different, and
   * its Jobs are settled by `recoverExpiredJobs` as failed attempts. `false`
   * when the Job was no longer `holder`'s.
   */
  const returnJobToQueue = Effect.fn("returnJobToQueue")(function* (input: {
    jobId: string;
    holder: string;
    reason: string;
  }) {
    return yield* withDbTransaction(db, (tx) =>
      Effect.gen(function* () {
        const job = yield* lockHeld(tx, input.jobId, input.holder);
        if (!job) return false;
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
          reason: input.reason,
        });
        return true;
      })
    );
  });

  /**
   * Every running Job whose lease has run out — its sidecar died, or was
   * stopped without settling it — is settled as an interrupted attempt by the
   * retry rule. A Job of a kind in `neverRetryKinds` (posting) ends
   * `interrupted` whatever its attempts. Safe to call at any time and from
   * any process.
   * Never one in `stillRunning`, the caller's own live runs: a late
   * heartbeat can lapse a lease while the post goes on.
   */
  const recoverExpiredJobs = Effect.fn("recoverExpiredJobs")(function* (input: {
    neverRetryKinds: readonly string[];
    stillRunning: readonly string[];
  }) {
    return yield* withDbTransaction(db, (tx) =>
      Effect.gen(function* () {
        const expired = yield* makeDbCall(() =>
          tx
            .select()
            .from(jobs)
            .where(
              and(
                eq(jobs.status, "running"),
                lt(jobs.leaseUntil, sql`now()`),
                input.stillRunning.length === 0
                  ? undefined
                  : notInArray(jobs.id, [...input.stillRunning])
              )
            )
            .orderBy(asc(jobs.createdAt))
            .for("update", { skipLocked: true })
        );
        const recovered: { jobId: string; outcome: FailureOutcome }[] = [];
        for (const job of expired) {
          const mayRetry = !input.neverRetryKinds.includes(job.kind);
          const failure: JobFailure = {
            tag: "JobInterrupted",
            message: mayRetry
              ? "The sidecar running this job stopped before it finished"
              : INTERRUPTED_POST_MESSAGE,
            cause: `lease held by ${job.holder ?? "nobody"} expired at ${job.leaseUntil?.toISOString() ?? "?"}`,
          };
          recovered.push({
            jobId: job.id,
            outcome: yield* settleFailure(tx, job, failure, true, mayRetry),
          });
        }
        return recovered;
      })
    );
  });

  const getJob = Effect.fn("getJob")(function* (jobId: string) {
    const [job] = yield* makeDbCall(() =>
      db.select().from(jobs).where(eq(jobs.id, jobId))
    );
    return job;
  });

  const listJobEvents = Effect.fn("listJobEvents")(function* (jobId: string) {
    return yield* makeDbCall(() =>
      db
        .select()
        .from(jobEvents)
        .where(eq(jobEvents.jobId, jobId))
        .orderBy(asc(jobEvents.id))
    );
  });

  // -- Subscribers -----------------------------------------------------------

  /** The newest Job Event's id, or 0 when there is none: where a feed starts. */
  const latestJobEventId = Effect.fn("latestJobEventId")(function* () {
    const [row] = yield* makeDbCall(() =>
      db
        .select({ id: jobEvents.id })
        .from(jobEvents)
        .orderBy(desc(jobEvents.id))
        .limit(1)
    );
    return row?.id ?? 0;
  });

  /** Up to `limit` Job Events with an id above `after`, oldest first. */
  const listJobEventsAfter = Effect.fn("listJobEventsAfter")(function* (input: {
    after: number;
    limit: number;
  }) {
    const rows = yield* makeDbCall(() =>
      db
        .select({ event: jobEvents, job: jobSummaryColumns })
        .from(jobEvents)
        .innerJoin(jobs, eq(jobs.id, jobEvents.jobId))
        .where(gt(jobEvents.id, input.after))
        .orderBy(asc(jobEvents.id))
        .limit(input.limit)
    );
    return rows as JobEventWithJob[];
  });

  /**
   * What a new subscriber starts from, each Job with all of its events,
   * oldest Job first: every Job not yet finished, and every finished Job the
   * author has not dismissed (`dismissJobs`) — a failed or interrupted one
   * until they do, because it needs them; any other only if it finished in
   * the last `finishedWithinMs`.
   */
  const listRecentJobs = Effect.fn("listRecentJobs")(function* (input: {
    finishedWithinMs: number;
  }) {
    const recent = yield* makeDbCall(() =>
      db
        .select(jobSummaryColumns)
        .from(jobs)
        .where(
          or(
            inArray(jobs.status, ["queued", "running"]),
            and(
              notDismissed,
              or(
                inArray(jobs.status, ["failed", "interrupted"]),
                gt(
                  jobs.finishedAt,
                  sql`now() - (${input.finishedWithinMs} * interval '1 millisecond')`
                )
              )
            )
          )
        )
        .orderBy(asc(jobs.createdAt), asc(jobs.id))
    );
    if (recent.length === 0) return [];
    const events = yield* makeDbCall(() =>
      db
        .select()
        .from(jobEvents)
        .where(
          inArray(
            jobEvents.jobId,
            recent.map((j) => j.id)
          )
        )
        .orderBy(asc(jobEvents.id))
    );
    return recent.map((job) => ({
      job: job as JobSummary,
      events: events.filter((e) => e.jobId === job.id),
    }));
  });

  // -- The sidecar lease -----------------------------------------------------

  /**
   * Take the one sidecar lease for this database, or report who holds it. A
   * lease that has run out is anyone's; a live one is only its holder's.
   */
  const acquireSidecarLease = Effect.fn("acquireSidecarLease")(
    function* (input: {
      holder: string;
      pid: number;
      hostname: string;
      checkout: string;
      gitSha: string;
      socket: string;
      leaseMs: number;
    }) {
      const values = {
        holder: input.holder,
        pid: input.pid,
        hostname: input.hostname,
        checkout: input.checkout,
        gitSha: input.gitSha,
        socket: input.socket,
        database: sql`current_database()`,
        leaseUntil: leaseEnd(input.leaseMs),
        acquiredAt: sql`now()`,
        renewedAt: sql`now()`,
      };
      const [taken] = yield* makeDbCall(() =>
        db
          .insert(sidecarLease)
          .values(values)
          .onConflictDoUpdate({
            target: sidecarLease.id,
            set: values,
            setWhere: sql`${sidecarLease.leaseUntil} < now() OR ${sidecarLease.holder} = ${input.holder}`,
          })
          .returning()
      );
      if (taken) return { acquired: true as const, lease: taken };
      const [current] = yield* makeDbCall(() => db.select().from(sidecarLease));
      return { acquired: false as const, lease: current };
    }
  );

  /** Extend `holder`'s lease. `false` means it is no longer the holder. */
  const renewSidecarLease = Effect.fn("renewSidecarLease")(function* (input: {
    holder: string;
    leaseMs: number;
  }) {
    const rows = yield* makeDbCall(() =>
      db
        .update(sidecarLease)
        .set({ leaseUntil: leaseEnd(input.leaseMs), renewedAt: sql`now()` })
        .where(eq(sidecarLease.holder, input.holder))
        .returning({ holder: sidecarLease.holder })
    );
    return rows.length > 0;
  });

  /** Let the lease go at once, so the next sidecar need not wait it out. */
  const releaseSidecarLease = Effect.fn("releaseSidecarLease")(function* (
    holder: string
  ) {
    yield* makeDbCall(() =>
      db
        .update(sidecarLease)
        .set({ leaseUntil: sql`now()` })
        .where(eq(sidecarLease.holder, holder))
    );
  });

  return {
    ...createEnqueueJobOperations(db),
    claimNextJob,
    heartbeatJobs,
    appendJobEvent,
    completeJob,
    failJobAttempt,
    returnJobToQueue,
    ...createPostingJobOperations(db),
    recoverExpiredJobs,
    latestJobEventId,
    listJobEventsAfter,
    ...createJobFeedOperations(db),
    listRecentJobs,
    ...createDismissJobOperations(db),
    getJob,
    listJobEvents,
    acquireSidecarLease,
    renewSidecarLease,
    releaseSidecarLease,
  };
};

export class JobOperationsService extends Effect.Service<JobOperationsService>()(
  "JobOperationsService",
  {
    effect: Effect.gen(function* () {
      const db = yield* DrizzleService;
      return createJobOperations(db);
    }),
  }
) {}
