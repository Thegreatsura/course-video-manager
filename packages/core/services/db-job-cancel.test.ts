import { describe, expect, it } from "@effect/vitest";
import { beforeAll, beforeEach } from "vitest";
import { Effect, Layer } from "effect";
import {
  CANCEL_REQUESTED_EVENT,
  JobOperationsService,
  dependencyFailedMessage,
} from "./db-job-operations.server.js";
import { DrizzleService } from "./drizzle-service.server.js";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "../test-utils/pglite.js";

/**
 * The author's Cancel (#2109): the first use of the `cancelled` Job status.
 * A queued Job ends at once; a running one is asked, and its handler ends it.
 */

let testDb: TestDb;
let testLayer: Layer.Layer<JobOperationsService>;

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;
  testLayer = JobOperationsService.Default.pipe(
    Layer.provide(Layer.succeed(DrizzleService, testDb as any))
  );
});

beforeEach(async () => {
  await truncateAllTables(testDb);
});

const KINDS = ["storage-move"];

const enqueue = (kind = "storage-move", dependsOn: string | null = null) =>
  Effect.flatMap(JobOperationsService, (ops) =>
    ops.enqueueJob({
      id: null,
      kind,
      title: `A ${kind}`,
      lane: "default",
      params: {},
      maxAttempts: 2,
      dependsOn,
      subject: null,
    })
  );

const claim = Effect.flatMap(JobOperationsService, (ops) =>
  ops.claimNextJob({ lane: "default", holder: "h", leaseMs: 30_000 })
);

const eventTypes = (jobId: string) =>
  Effect.flatMap(JobOperationsService, (ops) => ops.listJobEvents(jobId)).pipe(
    Effect.map((events) => events.map((e) => e.type))
  );

describe("requestJobCancel", () => {
  it.effect("ends a queued Job cancelled, and fails what waits on it", () =>
    Effect.gen(function* () {
      const ops = yield* JobOperationsService;
      const job = yield* enqueue();
      const behind = yield* enqueue("noop", job.id);

      const result = yield* ops.requestJobCancel({
        jobId: job.id,
        kinds: KINDS,
      });
      expect(result.outcome).toBe("cancelled");
      expect((yield* ops.getJob(job.id))!.status).toBe("cancelled");
      expect(yield* eventTypes(job.id)).toEqual(["queued", "cancelled"]);
      const after = (yield* ops.getJob(behind.id))!;
      expect(after.status).toBe("failed");
      expect((after.error as { message: string }).message).toBe(
        dependencyFailedMessage(job.title)
      );
      // Never claimed afterwards.
      expect(yield* claim).toBeUndefined();
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("asks a running Job to stop, once, and leaves it running", () =>
    Effect.gen(function* () {
      const ops = yield* JobOperationsService;
      const job = yield* enqueue();
      yield* claim;
      expect(yield* ops.isJobCancelRequested(job.id)).toBe(false);

      const first = yield* ops.requestJobCancel({
        jobId: job.id,
        kinds: KINDS,
      });
      const second = yield* ops.requestJobCancel({
        jobId: job.id,
        kinds: KINDS,
      });
      expect(first.outcome).toBe("requested");
      expect(second.outcome).toBe("requested");
      expect((yield* ops.getJob(job.id))!.status).toBe("running");
      expect(yield* ops.isJobCancelRequested(job.id)).toBe(true);
      const types = yield* eventTypes(job.id);
      expect(types.filter((t) => t === CANCEL_REQUESTED_EVENT)).toHaveLength(1);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("refuses a kind that cannot be cancelled, changing nothing", () =>
    Effect.gen(function* () {
      const ops = yield* JobOperationsService;
      const job = yield* enqueue("export");
      const result = yield* ops.requestJobCancel({
        jobId: job.id,
        kinds: KINDS,
      });
      expect(result.outcome).toBe("not-cancellable");
      expect((yield* ops.getJob(job.id))!.status).toBe("queued");
      expect(yield* eventTypes(job.id)).toEqual(["queued"]);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("leaves a finished Job as it is", () =>
    Effect.gen(function* () {
      const ops = yield* JobOperationsService;
      const job = yield* enqueue();
      yield* claim;
      yield* ops.completeJob({ jobId: job.id, holder: "h" });
      const result = yield* ops.requestJobCancel({
        jobId: job.id,
        kinds: KINDS,
      });
      expect(result.outcome).toBe("finished");
      expect((yield* ops.getJob(job.id))!.status).toBe("succeeded");
    }).pipe(Effect.provide(testLayer))
  );
});

describe("cancelJobAttempt", () => {
  it.effect("ends a held Job cancelled for good, attempts or not", () =>
    Effect.gen(function* () {
      const ops = yield* JobOperationsService;
      const job = yield* enqueue();
      yield* claim;
      yield* ops.requestJobCancel({ jobId: job.id, kinds: KINDS });

      expect(
        yield* ops.cancelJobAttempt({
          jobId: job.id,
          holder: "someone-else",
          message: "x",
        })
      ).toBe(false);
      expect(
        yield* ops.cancelJobAttempt({
          jobId: job.id,
          holder: "h",
          message: "Cancelled",
        })
      ).toBe(true);
      const after = (yield* ops.getJob(job.id))!;
      expect(after.status).toBe("cancelled");
      expect(after.finishedAt).not.toBeNull();
      expect((yield* eventTypes(job.id)).at(-1)).toBe("cancelled");
      expect(yield* claim).toBeUndefined();
    }).pipe(Effect.provide(testLayer))
  );
});
