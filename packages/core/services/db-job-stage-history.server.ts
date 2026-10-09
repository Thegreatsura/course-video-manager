import { sql } from "drizzle-orm";
import { Effect } from "effect";
import { jobEvents, jobs } from "../db/schema.js";
import type { Database } from "./drizzle-service.server.js";
import { makeDbCall } from "./db-job-calls.server.js";
import type { JobEvent, JobSummary } from "./db-job-operations.server.js";

/**
 * The ETA's stage history, read from `job_event`: how long each stage took in
 * the Jobs that finished. The browser folds these events exactly as it folds
 * the live stream (`features/jobs/job-stage-history.ts`), so the history is
 * keyed and measured one way only, and any tab in any browser starts with it.
 * Read-only. Part of `JobOperationsService`.
 */

/** How many succeeded Jobs of each kind the history looks back over. */
export const STAGE_HISTORY_JOBS_PER_KIND = 20;

/**
 * Events that only move a bar. The first of each per Job, type, Video and
 * stage is kept, since it can be the event that enters a stage (a Video's
 * first `video-progress`) and the first `video-upload-progress` carries the
 * upload's size (`totalBytes`). The rest add nothing a duration needs.
 */
const PROGRESS_EVENT_TYPES = [
  "progress",
  "video-progress",
  "video-upload-progress",
];

export const createStageHistoryOperations = (db: Database) => {
  /**
   * The newest `perKind` succeeded Jobs of each kind, oldest finish first,
   * each with its events (oldest first) minus the repeated progress events.
   * A Job that failed or was interrupted is left out: a stage cut short says
   * nothing about how long it takes.
   */
  const listJobStageHistory = Effect.fn("listJobStageHistory")(
    function* (input: { perKind: number }) {
      const recent = yield* makeDbCall(() =>
        db.execute<{
          id: string;
          kind: string;
          title: string;
          status: JobSummary["status"];
          attempt: number;
          max_attempts: number;
          subject_type: string | null;
          subject_id: string | null;
          created_at: string | Date;
        }>(sql`
          SELECT id, kind, title, status, attempt, max_attempts, subject_type,
                 subject_id, created_at
          FROM (
            SELECT ${jobs}.*,
                   row_number() OVER (
                     PARTITION BY ${jobs.kind}
                     ORDER BY ${jobs.finishedAt} DESC, ${jobs.id} DESC
                   ) AS nth
            FROM ${jobs}
            WHERE ${jobs.status} = 'succeeded'
          ) AS ranked
          WHERE nth <= ${input.perKind}
          ORDER BY finished_at ASC, id ASC
        `)
      );
      if (recent.rows.length === 0) return [];
      const ids = recent.rows.map((job) => job.id);
      const events = yield* makeDbCall(() =>
        db.execute<{
          id: number | string;
          job_id: string;
          type: string;
          data: Record<string, unknown>;
          at: string | Date;
        }>(sql`
          SELECT id, job_id, type, data, at
          FROM (
            SELECT ${jobEvents}.*,
                   row_number() OVER (
                     PARTITION BY ${jobEvents.jobId}, ${jobEvents.type},
                                  ${jobEvents.data}->>'videoId',
                                  ${jobEvents.data}->>'stage'
                     ORDER BY ${jobEvents.id}
                   ) AS nth
            FROM ${jobEvents}
            WHERE ${jobEvents.jobId} IN (${sql.join(
              ids.map((id) => sql`${id}`),
              sql`, `
            )})
          ) AS numbered
          WHERE nth = 1
             OR type NOT IN (${sql.join(
               PROGRESS_EVENT_TYPES.map((type) => sql`${type}`),
               sql`, `
             )})
          ORDER BY id ASC
        `)
      );
      const byJob = new Map<string, JobEvent[]>();
      for (const row of events.rows) {
        const event: JobEvent = {
          id: Number(row.id),
          jobId: row.job_id,
          type: row.type,
          data: row.data,
          at: new Date(row.at),
        };
        const list = byJob.get(row.job_id);
        if (list) list.push(event);
        else byJob.set(row.job_id, [event]);
      }
      return recent.rows.map((row) => ({
        job: {
          id: row.id,
          kind: row.kind,
          title: row.title,
          status: row.status,
          attempt: row.attempt,
          maxAttempts: row.max_attempts,
          subjectType: row.subject_type,
          subjectId: row.subject_id,
          createdAt: new Date(row.created_at),
        } satisfies JobSummary,
        events: byJob.get(row.id) ?? [],
      }));
    }
  );

  return { listJobStageHistory };
};
