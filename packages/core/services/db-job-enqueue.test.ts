import { describe, expect, it } from "@effect/vitest";
import { beforeAll, beforeEach } from "vitest";
import { Effect, Layer } from "effect";
import { JobOperationsService, type Job } from "./db-job-operations.server.js";
import { DrizzleService } from "./drizzle-service.server.js";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "../test-utils/pglite.js";

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

const ID = "7f1c2a4e-1b7d-4c55-9a0e-5d2f8c3b6a10";

const enqueue = (
  overrides: Partial<{ id: string | null; kind: string; title: string }> = {}
) =>
  Effect.flatMap(JobOperationsService, (ops) =>
    ops.enqueueJob({
      id: overrides.id === undefined ? ID : overrides.id,
      kind: overrides.kind ?? "youtube",
      title: overrides.title ?? "Intro to Generics",
      lane: "posting",
      params: { videoId: "v1" },
      maxAttempts: 1,
      dependsOn: null,
      subject: { type: "video", id: "v1" },
    })
  );

describe("enqueueJob, named by the caller", () => {
  it.effect(
    "is idempotent on the id: a request sent again (its first answer lost) adds no second Job",
    () =>
      Effect.gen(function* () {
        const ops = yield* JobOperationsService;
        const first = yield* enqueue();
        // The browser never heard the answer, so it asks again.
        const again = yield* enqueue();

        expect(again.id).toBe(first.id);
        expect((yield* ops.getJob(ID))?.status).toBe("queued");
        const events = yield* ops.listJobEvents(ID);
        expect(events.map((e) => e.type)).toEqual(["queued"]);
      }).pipe(Effect.provide(testLayer))
  );

  it.effect("answers with the Job as it is now, not as it was asked for", () =>
    Effect.gen(function* () {
      const ops = yield* JobOperationsService;
      yield* enqueue();
      const claimed = yield* ops.claimNextJob({
        lane: "posting",
        holder: "sidecar",
        leaseMs: 30_000,
      });
      expect(claimed?.id).toBe(ID);

      const again: Job = yield* enqueue();
      expect(again.status).toBe("running");
      expect(yield* ops.listJobEvents(ID)).toHaveLength(2);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("refuses an id already taken by a different Job", () =>
    Effect.gen(function* () {
      yield* enqueue();
      const other = yield* Effect.flip(enqueue({ kind: "buffer" }));
      expect(other).toMatchObject({ _tag: "JobIdTakenError", jobId: ID });
    }).pipe(Effect.provide(testLayer))
  );
});
