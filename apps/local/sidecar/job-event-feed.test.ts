import { describe, expect, it } from "@effect/vitest";
import { beforeAll, beforeEach } from "vitest";
import { Effect, Layer, Option, Queue } from "effect";
import { sql } from "drizzle-orm";
import { jobEvents } from "@cvm/core/db/schema";
import {
  JobOperationsService,
  type JobEventWithJob,
} from "@cvm/core/services/db-job-operations.server";
import { DrizzleService } from "@cvm/core/services/drizzle-service.server";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/pglite";
import { makeJobEventFeed } from "./job-event-feed";
import { enqueueJob } from "./job-kinds";
import { noopJobKind } from "./kinds/noop";

let testDb: TestDb;

beforeAll(async () => {
  testDb = (await createTestDb()).testDb;
});

beforeEach(async () => {
  await truncateAllTables(testDb);
});

const layer = () =>
  JobOperationsService.Default.pipe(
    Layer.provide(Layer.succeed(DrizzleService, testDb as any))
  );

const run = (statement: ReturnType<typeof sql>) =>
  Effect.promise(() => testDb.execute(statement));

/** A Job to hang events on (its own `queued` event is written too). */
const aJob = enqueueJob({
  id: null,
  kind: "noop",
  title: "feed",
  params: {},
  dependsOn: null,
  subject: null,
  attemptsSpent: 0,
  registry: { noop: noopJobKind },
});

/** One subscriber: everything it has been streamed, and a way to wait for more. */
const subscriber = Effect.gen(function* () {
  const feed = yield* makeJobEventFeed({ pollMs: 50, pageSize: 500 });
  const live = yield* feed.subscribe;
  const seen: JobEventWithJob[] = [];
  const types = () => seen.map((row) => row.event.type);
  const waitFor = (done: (types: string[]) => boolean) =>
    Effect.gen(function* () {
      for (let i = 0; i < 60 && !done(types()); i++) {
        yield* feed.wake;
        const batch = yield* Queue.take(live).pipe(Effect.timeoutOption(50));
        if (Option.isSome(batch)) seen.push(...batch.value);
      }
      if (!done(types())) {
        return yield* Effect.dieMessage(`never streamed: ${types().join()}`);
      }
    });
  // The first read after subscribing: the feed has started over.
  yield* waitFor((all) => all.includes("queued"));
  return { types, waitFor };
});

describe("the Job Event feed", () => {
  it.live(
    "streams a live event whose time, on the database's clock, is minutes behind the sidecar's",
    () =>
      Effect.gen(function* () {
        const job = yield* aJob;
        const stream = yield* subscriber;
        // The database's clock reads two minutes behind the sidecar's: the
        // event is written now, but stamped two minutes ago.
        yield* run(
          sql`INSERT INTO ${jobEvents} (job_id, type, data, at) VALUES (${job.id}, 'skewed', '{}'::jsonb, now() - interval '2 minutes')`
        );
        yield* stream.waitFor((all) => all.includes("skewed"));
      }).pipe(Effect.scoped, Effect.provide(layer()))
  );

  it.live(
    "streams an event that commits after many newer ones, however far behind the newest it is",
    () =>
      Effect.gen(function* () {
        const job = yield* aJob;
        const stream = yield* subscriber;
        // A writer takes an id, then is slow to commit: 200 events written
        // after it commit first, and are streamed.
        const taken = yield* run(
          sql`SELECT nextval(pg_get_serial_sequence('"course-video-manager_job_event"', 'id'))::int AS id`
        );
        const lateId = Number((taken.rows[0] as { id: number }).id);
        yield* run(
          sql`INSERT INTO ${jobEvents} (job_id, type, data) SELECT ${job.id}, 'newer', '{}'::jsonb FROM generate_series(1, 200)`
        );
        yield* stream.waitFor(
          (all) => all.filter((t) => t === "newer").length === 200
        );

        // Now the slow writer commits, 200 ids behind the newest.
        yield* run(
          sql`INSERT INTO ${jobEvents} (id, job_id, type, data) VALUES (${lateId}, ${job.id}, 'late', '{}'::jsonb)`
        );
        yield* stream.waitFor((all) => all.includes("late"));
        expect(stream.types().filter((t) => t === "late")).toEqual(["late"]);
      }).pipe(Effect.scoped, Effect.provide(layer()))
  );
});
