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
 * A bigserial id is taken at insert but becomes visible at commit, so two
 * writers can commit out of order. The poller therefore re-reads the last
 * `lookback` ids each time and publishes only the ones it has not published
 * before. A subscriber may still see an event twice (once in its snapshot,
 * once live); the jobs reducer ignores an event it has already applied.
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
 * How long before a resync an event may have been written and still be
 * published by it: the late commits and the snapshot's edge that `lookback`
 * is for are a matter of seconds.
 */
const SNAPSHOT_EDGE_MS = 60_000;

export const makeJobEventFeed = (opts: {
  readonly pollMs: number;
  /** How many ids back each poll looks again, for late commits. */
  readonly lookback: number;
  /** How many events one read takes at most. */
  readonly pageSize: number;
}): Effect.Effect<JobEventFeed, unknown, JobOperationsService | Scope.Scope> =>
  Effect.gen(function* () {
    const ops = yield* JobOperationsService;
    const pubsub = yield* PubSub.unbounded<readonly JobEventWithJob[]>();
    const wakeQueue = yield* Queue.sliding<void>(1);
    let subscribers = 0;
    let cursor = 0;
    // Set when the first subscriber arrives: the events written while nobody
    // listened are in that subscriber's snapshot, so the poller starts over
    // from the newest (less `lookback`, which also covers the snapshot's edge).
    let resync = true;
    // When the last resync happened. The window it re-reads holds old events
    // too — the newest 50 may be yesterday's — and those are already in the
    // new subscriber's snapshot, or left out of it on purpose (dismissed, or
    // succeeded too long ago). Publishing them again brought yesterday's
    // uploads back as rows and toasts in the morning's first tab, so an event
    // written well before the resync is marked seen, never published.
    let resyncedAt = 0;
    const published = new Set<number>();

    const poll = Effect.gen(function* () {
      if (subscribers > 0 && resync) {
        resync = false;
        cursor = yield* ops.latestJobEventId();
        published.clear();
        resyncedAt = Date.now();
      }
      while (subscribers > 0) {
        const rows = yield* ops.listJobEventsAfter({
          after: Math.max(0, cursor - opts.lookback),
          limit: opts.pageSize,
        });
        const fresh = rows.filter((r) => !published.has(r.event.id));
        for (const row of fresh) {
          published.add(row.event.id);
          cursor = Math.max(cursor, row.event.id);
        }
        for (const id of published) {
          if (id <= cursor - opts.lookback) published.delete(id);
        }
        const news = fresh.filter(
          (r) => r.event.at.getTime() >= resyncedAt - SNAPSHOT_EDGE_MS
        );
        if (news.length > 0) yield* PubSub.publish(pubsub, news);
        // A full page of news means there is more behind it; anything less is all.
        if (fresh.length === 0 || rows.length < opts.pageSize) return;
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
