import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Effect, Layer } from "effect";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/pglite";
import { DrizzleService } from "@/services/drizzle-service.server";
import { JobOperationsService } from "@cvm/core/services/db-job-operations.server";
import { CLIP_TRANSCRIPTION_EVENTS } from "@/features/video-editor/transcribe-clips-response";
import { enqueueJob, JOB_KIND_SPECS } from "./job-specs";

let testDb: TestDb;
let jobOps: Layer.Layer<JobOperationsService>;

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;
  jobOps = JobOperationsService.Default.pipe(
    Layer.provide(Layer.succeed(DrizzleService, testDb as never))
  );
});

beforeEach(async () => {
  await truncateAllTables(testDb);
});

const run = <A, E>(effect: Effect.Effect<A, E, JobOperationsService>) =>
  Effect.runPromise(effect.pipe(Effect.provide(jobOps)));

const transcribe = (
  clipIds: string[],
  opts: { video?: string; id?: string } = {}
) =>
  enqueueJob({
    id: opts.id ?? crypto.randomUUID(),
    kind: "transcribe-clips",
    title: "Transcribe",
    params: { clipIds },
    dependsOn: null,
    subject: { type: "video", id: opts.video ?? "v1" },
    attemptsSpent: 0,
    registry: JOB_KIND_SPECS,
  });

const jobCount = async () => (await testDb.query.jobs.findMany()).length;

describe("enqueueing a transcribe-clips Job", () => {
  it("answers with the live Job that already covers the same Clips", async () => {
    const first = await run(transcribe(["a", "b"]));
    // A second tab, or a double click: the same Clips, in any order.
    const second = await run(transcribe(["b", "a"]));

    expect(second.id).toBe(first.id);
    expect(await jobCount()).toBe(1);
  });

  it("answers with a running Job that has not settled those Clips yet", async () => {
    const first = await run(transcribe(["a", "b"]));
    await run(
      Effect.flatMap(JobOperationsService, (ops) =>
        ops.claimNextJob({ lane: "default", holder: "s1", leaseMs: 60_000 })
      )
    );

    const second = await run(transcribe(["a", "b"]));

    expect(second.id).toBe(first.id);
  });

  it("adds a Job when the live one already settled one of the Clips", async () => {
    // Re-transcribing again after a Clip landed must transcribe it again.
    const first = await run(transcribe(["a", "b"]));
    await run(
      Effect.flatMap(JobOperationsService, (ops) =>
        ops.appendJobEvent({
          jobId: first.id,
          type: CLIP_TRANSCRIPTION_EVENTS.clipSettled,
          data: { id: "a", transcriptionStatus: "failed" },
        })
      )
    );

    const second = await run(transcribe(["a", "b"]));

    expect(second.id).not.toBe(first.id);
  });

  it("adds a Job for a different set of Clips, or another Video", async () => {
    const first = await run(transcribe(["a", "b"]));

    const fewer = await run(transcribe(["a"]));
    const more = await run(transcribe(["a", "b", "c"]));
    const elsewhere = await run(transcribe(["a", "b"], { video: "v2" }));

    expect(new Set([first.id, fewer.id, more.id, elsewhere.id]).size).toBe(4);
  });

  it("adds a Job once the earlier one has finished", async () => {
    const first = await run(transcribe(["a", "b"]));
    await run(
      Effect.flatMap(JobOperationsService, (ops) =>
        Effect.gen(function* () {
          yield* ops.claimNextJob({
            lane: "default",
            holder: "s1",
            leaseMs: 60_000,
          });
          yield* ops.completeJob({ jobId: first.id, holder: "s1" });
        })
      )
    );

    const second = await run(transcribe(["a", "b"]));

    expect(second.id).not.toBe(first.id);
  });
});
