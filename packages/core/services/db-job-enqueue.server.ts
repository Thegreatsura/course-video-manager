import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { Data, Effect } from "effect";
import { jobEvents, jobs } from "../db/schema.js";
import type { Database } from "./drizzle-service.server.js";
import { dependencyFailure, makeDbCall } from "./db-job-calls.server.js";
import { UnknownDBServiceError } from "./db-service-errors.js";
import { withDbTransaction } from "./with-db-transaction.server.js";

/** A Job in one of these never succeeds, so nothing waiting on it may start. */
const UNSUCCESSFUL_FOR_GOOD = ["failed", "interrupted", "cancelled"];

/** A Job in one of these may still run: a request for the same work joins it. */
const LIVE: Array<"queued" | "running"> = ["queued", "running"];

/** A live Job of the same kind and subject, as `coveredBy` is shown it. */
export interface LiveJob {
  readonly params: unknown;
  readonly events: ReadonlyArray<{
    readonly type: string;
    readonly data: unknown;
  }>;
}

/** The caller named a Job by an id another, different Job already has. */
export class JobIdTakenError extends Data.TaggedError("JobIdTakenError")<{
  readonly jobId: string;
  readonly message: string;
}> {}

/**
 * The one statement that adds a Job (the enqueue the kind registry's
 * `enqueueJob` checks first). Part of `JobOperationsService`.
 */
export const createEnqueueJobOperations = (db: Database) => {
  const insertEvent = (
    handle: Database,
    jobId: string,
    type: string,
    data: Record<string, unknown>
  ) => makeDbCall(() => handle.insert(jobEvents).values({ jobId, type, data }));

  /**
   * Add a Job, `queued`. A Job that waits on one that has already failed
   * for good is added `failed` instead, naming it: a parent fails its
   * waiting Jobs only as it settles (`failDependents`), so a Job that
   * arrives later would otherwise wait for ever — never claimed, never
   * settled, not dismissable. The parent's row is locked `FOR SHARE` so it
   * cannot settle between the look and the insert.
   *
   * IDEMPOTENT ON A CALLER'S ID. The browser picks the id, so when an
   * enqueue's answer is lost it can ask again: an id that is already the same
   * Job (same kind, same dependency) adds nothing and answers with that Job
   * as it is now. The same id on a different Job is `JobIdTakenError`.
   *
   * ONE LIVE JOB PER PIECE OF WORK, when the kind says what that is
   * (`coveredBy`): a request whose work a live (queued or running) Job of the
   * same kind and subject already covers adds nothing, and answers with that
   * Job. A transaction-scoped advisory lock on the kind and subject makes two
   * such requests at once take turns, so they cannot both add one.
   */
  const enqueueJob = Effect.fn("enqueueJob")(function* (input: {
    /**
     * The Job's id, when the caller chose it — the browser does, so it can
     * name the Job (and wait on it) before the request returns. `null` takes
     * a fresh one.
     */
    id: string | null;
    kind: string;
    title: string;
    lane: string;
    params: unknown;
    maxAttempts: number;
    dependsOn: string | null;
    subject: { type: string; id: string } | null;
    /** Whether a live Job of this kind and subject already does this work. */
    coveredBy?: (live: LiveJob) => boolean;
  }) {
    return yield* withDbTransaction(db, (tx) =>
      Effect.gen(function* () {
        const [parent] = input.dependsOn
          ? yield* makeDbCall(() =>
              tx
                .select({ status: jobs.status, title: jobs.title })
                .from(jobs)
                .where(eq(jobs.id, input.dependsOn ?? ""))
                .for("share")
            )
          : [];
        const failure =
          parent && UNSUCCESSFUL_FOR_GOOD.includes(parent.status)
            ? dependencyFailure(parent.title)
            : null;
        if (input.id !== null) {
          const [existing] = yield* makeDbCall(() =>
            tx
              .select()
              .from(jobs)
              .where(eq(jobs.id, input.id ?? ""))
          );
          if (existing) {
            if (
              existing.kind !== input.kind ||
              existing.dependsOn !== input.dependsOn
            ) {
              return yield* new JobIdTakenError({
                jobId: existing.id,
                message: `Job ${existing.id} is already a ${existing.kind} Job`,
              });
            }
            return existing;
          }
        }
        const coveredBy = input.coveredBy;
        const subject = input.subject;
        if (coveredBy && subject) {
          yield* makeDbCall(() =>
            tx.execute(
              sql`select pg_advisory_xact_lock(hashtext(${`${input.kind}:${subject.type}:${subject.id}`}))`
            )
          );
          const live = yield* makeDbCall(() =>
            tx
              .select()
              .from(jobs)
              .where(
                and(
                  eq(jobs.kind, input.kind),
                  eq(jobs.subjectType, subject.type),
                  eq(jobs.subjectId, subject.id),
                  inArray(jobs.status, LIVE)
                )
              )
              .orderBy(asc(jobs.createdAt))
          );
          for (const job of live) {
            const events = yield* makeDbCall(() =>
              tx
                .select({ type: jobEvents.type, data: jobEvents.data })
                .from(jobEvents)
                .where(eq(jobEvents.jobId, job.id))
                .orderBy(asc(jobEvents.id))
            );
            if (coveredBy({ params: job.params, events })) return job;
          }
        }
        const [job] = yield* makeDbCall(() =>
          tx
            .insert(jobs)
            .values({
              ...(input.id === null ? {} : { id: input.id }),
              kind: input.kind,
              title: input.title,
              lane: input.lane,
              params: input.params ?? {},
              maxAttempts: input.maxAttempts,
              dependsOn: input.dependsOn,
              subjectType: input.subject?.type ?? null,
              subjectId: input.subject?.id ?? null,
              ...(failure
                ? {
                    status: "failed" as const,
                    error: failure,
                    finishedAt: sql`now()`,
                  }
                : {}),
            })
            .returning()
        );
        if (!job) {
          return yield* new UnknownDBServiceError({
            cause: "No job was returned from the database",
          });
        }
        yield* insertEvent(tx, job.id, "queued", {
          kind: job.kind,
          lane: job.lane,
          dependsOn: job.dependsOn,
        });
        if (failure) {
          yield* insertEvent(tx, job.id, "failed", { error: failure });
        }
        return job;
      })
    );
  });

  return { enqueueJob };
};
