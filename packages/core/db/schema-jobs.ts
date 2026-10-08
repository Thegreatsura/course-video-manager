import { sql } from "drizzle-orm";
import {
  bigserial,
  check,
  index,
  integer,
  jsonb,
  text,
  timestamp,
  varchar,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { createTable } from "./table-creator.js";

/**
 * Background work, as rows: the durable queue the **Sidecar** takes **Jobs**
 * from (`apps/local/sidecar/`, docs/plans/background-jobs-sidecar.md).
 *
 * These tables live in the same database as the domain data on purpose: a
 * verify-cvm clone gets its own empty queue for free, and the connection guard
 * that stops a worktree writing to production also stops a worktree's sidecar
 * claiming the author's Jobs. Every statement against them is in
 * `services/db-job-operations.server.ts`.
 */

/**
 * - `queued`: waiting for a sidecar to claim it (a retry goes back here).
 * - `running`: claimed; `holder` is the sidecar and `lease_until` its lease.
 * - `succeeded` / `failed`: finished. `failed` is the last attempt's failure.
 * - `interrupted`: its sidecar stopped mid-run on the last attempt it had.
 * - `cancelled`: stopped on request (no verb yet).
 */
export const JOB_STATUSES = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "interrupted",
  "cancelled",
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/** Statuses a Job never leaves. */
export const FINISHED_JOB_STATUSES: readonly JobStatus[] = [
  "succeeded",
  "failed",
  "interrupted",
  "cancelled",
];

export const jobs = createTable(
  "job",
  {
    id: varchar("id", { length: 255 })
      .notNull()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    /** Which handler runs it — a key of the sidecar's kind registry. */
    kind: text("kind").notNull(),
    /** What a person sees on the row ("Export: Intro to Generics"). */
    title: text("title").notNull(),
    /** Which of the sidecar's lanes runs it, fixed at enqueue time. */
    lane: text("lane").notNull(),
    params: jsonb("params").notNull().default({}),
    status: text("status").$type<JobStatus>().notNull().default("queued"),
    /** A Job that may start only once this one has succeeded. */
    dependsOn: varchar("depends_on", { length: 255 }).references(
      (): AnyPgColumn => jobs.id,
      { onDelete: "set null" }
    ),
    /** 1 on the first run; a retry runs the same row with `attempt + 1`. */
    attempt: integer("attempt").notNull().default(1),
    maxAttempts: integer("max_attempts").notNull(),
    /** The sidecar running it (its `sidecar_lease.holder`), while running. */
    holder: text("holder"),
    leaseUntil: timestamp("lease_until", { mode: "date", withTimezone: true }),
    progress: jsonb("progress"),
    /** The last attempt's failure, the whole cause chain, never a summary. */
    error: jsonb("error"),
    subjectType: text("subject_type"),
    subjectId: text("subject_id"),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    startedAt: timestamp("started_at", { mode: "date", withTimezone: true }),
    finishedAt: timestamp("finished_at", { mode: "date", withTimezone: true }),
  },
  (table) => [
    index("job_lane_status_created_idx").on(
      table.lane,
      table.status,
      table.createdAt
    ),
    index("job_status_lease_idx").on(table.status, table.leaseUntil),
    index("job_depends_on_idx").on(table.dependsOn),
    check(
      "job_status_valid",
      sql`${table.status} IN ('queued', 'running', 'succeeded', 'failed', 'interrupted', 'cancelled')`
    ),
    check(
      "job_attempts_valid",
      sql`${table.attempt} >= 1 AND ${table.maxAttempts} >= 1 AND ${table.attempt} <= ${table.maxAttempts}`
    ),
  ]
);

/**
 * Append-only: everything that happened to a Job, in order. `id` is the
 * cursor a subscriber resumes from.
 */
export const jobEvents = createTable(
  "job_event",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    jobId: varchar("job_id", { length: 255 })
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    data: jsonb("data").notNull().default({}),
    at: timestamp("at", { mode: "date", withTimezone: true })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("job_event_job_id_idx").on(table.jobId, table.id)]
);

/**
 * One row at most: the sidecar that may run Jobs against this database. A
 * second sidecar finds a live lease here and stops, naming the holder.
 */
export const sidecarLease = createTable(
  "sidecar_lease",
  {
    id: text("id").notNull().primaryKey().default("sidecar"),
    /** A fresh id per sidecar process. */
    holder: text("holder").notNull(),
    pid: integer("pid").notNull(),
    hostname: text("hostname").notNull(),
    checkout: text("checkout").notNull(),
    gitSha: text("git_sha").notNull(),
    socket: text("socket").notNull(),
    /** The database the lease was taken in, as the server names it. */
    database: text("database")
      .notNull()
      .default(sql`current_database()`),
    leaseUntil: timestamp("lease_until", {
      mode: "date",
      withTimezone: true,
    }).notNull(),
    acquiredAt: timestamp("acquired_at", { mode: "date", withTimezone: true })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    renewedAt: timestamp("renewed_at", { mode: "date", withTimezone: true })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [check("sidecar_lease_single_row", sql`${table.id} = 'sidecar'`)]
);
