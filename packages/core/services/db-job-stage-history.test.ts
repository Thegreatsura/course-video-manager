import { describe, expect, it } from "@effect/vitest";
import { beforeAll, beforeEach } from "vitest";
import { Effect, Layer } from "effect";
import { sql } from "drizzle-orm";
import { jobEvents, jobs } from "../db/schema.js";
import { JobOperationsService } from "./db-job-operations.server.js";
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

/** A Job that finished `minutesAgo`, with these events, in order. */
const finishedJob = (input: {
  id: string;
  kind: string;
  status: "succeeded" | "failed" | "interrupted";
  minutesAgo: number;
  events: { type: string; data?: Record<string, unknown> }[];
}) =>
  Effect.promise(async () => {
    await testDb.insert(jobs).values({
      id: input.id,
      kind: input.kind,
      title: input.id,
      lane: "default",
      maxAttempts: 1,
      status: input.status,
      finishedAt: sql`now() - (${input.minutesAgo} * interval '1 minute')`,
    });
    for (const event of input.events) {
      await testDb
        .insert(jobEvents)
        .values({ jobId: input.id, type: event.type, data: event.data ?? {} });
    }
  });

const listHistory = (perKind: number) =>
  Effect.flatMap(JobOperationsService, (ops) =>
    ops.listJobStageHistory({ perKind })
  );

describe("listJobStageHistory", () => {
  it.effect(
    "gives succeeded Jobs only, oldest finish first, with their events in order",
    () =>
      Effect.gen(function* () {
        const events = [
          { type: "queued" },
          { type: "started" },
          { type: "stage", data: { stage: "concatenating-clips" } },
          { type: "succeeded" },
        ];
        yield* finishedJob({
          id: "newer",
          kind: "export",
          status: "succeeded",
          minutesAgo: 1,
          events,
        });
        yield* finishedJob({
          id: "older",
          kind: "export",
          status: "succeeded",
          minutesAgo: 5,
          events,
        });
        yield* finishedJob({
          id: "failed",
          kind: "export",
          status: "failed",
          minutesAgo: 2,
          events,
        });
        yield* finishedJob({
          id: "interrupted",
          kind: "publish",
          status: "interrupted",
          minutesAgo: 2,
          events,
        });

        const history = yield* listHistory(20);
        expect(history.map((h) => h.job.id)).toEqual(["older", "newer"]);
        expect(history[0]!.events.map((e) => e.type)).toEqual([
          "queued",
          "started",
          "stage",
          "succeeded",
        ]);
        expect(history[0]!.events[0]!.at).toBeInstanceOf(Date);
      }).pipe(Effect.provide(testLayer))
  );

  it.effect("keeps the newest `perKind` of each kind", () =>
    Effect.gen(function* () {
      for (const [i, kind] of [
        [1, "export"],
        [2, "export"],
        [3, "export"],
        [4, "publish"],
      ] as const) {
        yield* finishedJob({
          id: `${kind}-${i}`,
          kind,
          status: "succeeded",
          minutesAgo: 10 - i,
          events: [{ type: "succeeded" }],
        });
      }

      const history = yield* listHistory(2);
      expect(history.map((h) => h.job.id)).toEqual([
        "export-2",
        "export-3",
        "publish-4",
      ]);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect(
    "drops repeated progress events, keeping the first per stage and per Video",
    () =>
      Effect.gen(function* () {
        yield* finishedJob({
          id: "publish",
          kind: "publish",
          status: "succeeded",
          minutesAgo: 1,
          events: [
            { type: "stage", data: { stage: "work" } },
            { type: "progress", data: { stage: "work", percent: 10 } },
            { type: "progress", data: { stage: "work", percent: 20 } },
            {
              type: "video-progress",
              data: { videoId: "a", stage: "normalizing-audio", percent: 5 },
            },
            {
              type: "video-progress",
              data: { videoId: "a", stage: "normalizing-audio", percent: 50 },
            },
            {
              type: "video-progress",
              data: { videoId: "b", stage: "normalizing-audio", percent: 5 },
            },
            {
              type: "video-upload-progress",
              data: { videoId: "a", uploadedBytes: 0, totalBytes: 900 },
            },
            {
              type: "video-upload-progress",
              data: { videoId: "a", uploadedBytes: 450, totalBytes: 900 },
            },
            { type: "video-succeeded", data: { videoId: "a" } },
            { type: "succeeded" },
          ],
        });

        const [only] = yield* listHistory(20);
        expect(
          only!.events.map((e) => [e.type, (e.data as any).percent ?? null])
        ).toEqual([
          ["stage", null],
          ["progress", 10],
          ["video-progress", 5],
          ["video-progress", 5],
          ["video-upload-progress", null],
          ["video-succeeded", null],
          ["succeeded", null],
        ]);
        expect(only!.events[4]!.data).toEqual({
          videoId: "a",
          uploadedBytes: 0,
          totalBytes: 900,
        });
      }).pipe(Effect.provide(testLayer))
  );

  it.effect("is empty with no succeeded Job", () =>
    Effect.gen(function* () {
      expect(yield* listHistory(20)).toEqual([]);
    }).pipe(Effect.provide(testLayer))
  );
});
