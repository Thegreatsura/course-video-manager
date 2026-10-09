import { Effect, PubSub, Queue, type Scope } from "effect";
import {
  JobOperationsService,
  type JobEventWithJob,
} from "@cvm/core/services/db-job-operations.server";

/**
 * Every new Job Event, fanned out to whoever is subscribed: the browser tabs,
 * through the app server's `/api/jobs/events` proxy.
 *
 * The pooler runs in transaction mode, so there is no LISTEN/NOTIFY: ONE
 * poller reads `job_event` for every subscriber, and only while there is one.
 * The sidecar wakes it whenever it writes an event itself (nearly all of
 * them), and a `/nudge` after an enqueue wakes it for the rest, so the poll
 * interval is only a backstop.
 *
 * LATE COMMITS. A bigserial id is taken at insert but becomes visible at
 * commit, so writers can commit out of order: id 7 may appear after id 300.
 * The poller keeps every id below its cursor that it has not yet seen — a
 * GAP — and asks for those again on every read, however far behind the
 * newest they are. A gap that stays empty for `GAP_TTL_MS` on the database's
 * clock was a rolled-back insert or a sequence value Postgres burned, and is
 * dropped; see `GAP_TTL_MS` for why nothing that commits can be that late.
 *
 * ONE CLOCK. Every time here is the database's (`now()`, which also stamps
 * `job_event.at`), never the sidecar's: a sidecar whose clock was a minute
 * off once dropped every live event as "old".
 *
 * A subscriber may still see an event twice (once in its snapshot, once
 * live); the jobs reducer ignores an event it has already applied.
 */
export interface JobEventFeed {
  /** Look for new events now rather than at the next poll. */
  readonly wake: Effect.Effect<void>;
  /** New events, in batches, for as long as the caller's scope lives. */
  readonly subscribe: Effect.Effect<
    Queue.Dequeue<readonly JobEventWithJob[]>,
    never,
    Scope.Scope
  >;
}

/**
 * How far before the first subscriber arrives the feed starts reading, on the
 * database's clock: the new subscriber's snapshot is read after it subscribes,
 * so an event committed around then may miss the snapshot, and is streamed
 * instead. Anything older is in the snapshot, or left out of it on purpose
 * (dismissed, or succeeded too long ago) — streaming those again brought
 * yesterday's uploads back as rows and toasts in the morning's first tab.
 */
const SNAPSHOT_EDGE_MS = 60_000;

/**
 * How long an unseen id is waited for before it is taken as never coming.
 * Every write to `job_event` is a short transaction in
 * `packages/core/services/db-job-*.server.ts` — a few statements, no outside
 * call — so a writer holds an id for milliseconds. Ten minutes is far past
 * any of them; an id still missing then was rolled back or burned.
 */
const GAP_TTL_MS = 10 * 60_000;

export const makeJobEventFeed = (opts: {
  readonly pollMs: number;
  /** How many events one read takes at most. */
  readonly pageSize: number;
}): Effect.Effect<JobEventFeed, unknown, JobOperationsService | Scope.Scope> =>
  Effect.gen(function* () {
    const ops = yield* JobOperationsService;
    const pubsub = yield* PubSub.unbounded<readonly JobEventWithJob[]>();
    const wakeQueue = yield* Queue.sliding<void>(1);
    let subscribers = 0;
    // Set when the first subscriber arrives: the events written while nobody
    // listened are in that subscriber's snapshot, so the poller starts over
    // from just before the snapshot's edge.
    let resync = true;
    /** Every id at or below it has been seen, or is a gap. `null`: from the first. */
    let cursor: number | null = null;
    /** Unseen ids below the cursor → when (database clock) they were first missed. */
    const gaps = new Map<number, number>();

    const poll = Effect.gen(function* () {
      if (subscribers > 0 && resync) {
        resync = false;
        cursor = yield* ops.jobEventFeedStart({ edgeMs: SNAPSHOT_EDGE_MS });
        gaps.clear();
      }
      while (subscribers > 0) {
        const { rows, nowMs } = yield* ops.readJobEventFeed({
          after: cursor ?? 0,
          missing: [...gaps.keys()],
          limit: opts.pageSize,
        });
        const news: JobEventWithJob[] = [];
        for (const row of rows) {
          const id = row.event.id;
          if (gaps.delete(id)) {
            news.push(row);
            continue;
          }
          if (cursor !== null && id <= cursor) continue;
          if (cursor !== null) {
            for (let missed = cursor + 1; missed < id; missed++) {
              gaps.set(missed, nowMs);
            }
          }
          cursor = id;
          news.push(row);
        }
        for (const [id, missedAt] of gaps) {
          if (nowMs - missedAt > GAP_TTL_MS) gaps.delete(id);
        }
        if (news.length > 0) yield* PubSub.publish(pubsub, news);
        // A full page means there is more behind it; anything less is all.
        if (rows.length < opts.pageSize) return;
      }
    });
    yield* Effect.forkScoped(
      Effect.forever(
        poll.pipe(
          Effect.catchAllCause((cause) =>
            Effect.logError("sidecar: the Job Event feed could not read", cause)
          ),
          Effect.zipRight(
            Queue.take(wakeQueue).pipe(Effect.timeoutOption(opts.pollMs))
          )
        )
      )
    );

    const wake = Queue.offer(wakeQueue, undefined).pipe(Effect.asVoid);

    return {
      wake,
      subscribe: Effect.acquireRelease(
        Effect.sync(() => {
          if (subscribers === 0) resync = true;
          subscribers++;
        }),
        () =>
          Effect.sync(() => {
            subscribers--;
          })
      ).pipe(
        Effect.zipRight(PubSub.subscribe(pubsub)),
        Effect.tap(() => wake)
      ),
    };
  });
