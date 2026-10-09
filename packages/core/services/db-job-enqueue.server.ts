import { eq, sql } from "drizzle-orm";
import { Effect } from "effect";
import { jobEvents, jobs } from "../db/schema.js";
import type { Database } from "./drizzle-service.server.js";
import { dependencyFailure, makeDbCall } from "./db-job-calls.server.js";
import { UnknownDBServiceError } from "./db-service-errors.js";
import { withDbTransaction } from "./with-db-transaction.server.js";

/** A Job in one of these never succeeds, so nothing waiting on it may start. */
const UNSUCCESSFUL_FOR_GOOD = ["failed", "interrupted", "cancelled"];

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
