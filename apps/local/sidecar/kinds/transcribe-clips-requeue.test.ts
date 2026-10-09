import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Effect, Fiber, Layer } from "effect";
import { NodeContext } from "@effect/platform-node";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/pglite";
import { ClipOperationsService } from "@/services/db-clip-operations.server";
import { DrizzleService } from "@/services/drizzle-service.server";
import { JobOperationsService } from "@cvm/core/services/db-job-operations.server";
import * as schema from "@cvm/core/db/schema";
import { WhisperTranscriptionService } from "@/services/whisper-transcription-service";
import { SidecarContextTest } from "@/services/sidecar-context";
import { seedCourseVersion } from "@/test-utils/autofill-service-test-setup";
import type { JobContext } from "../job-kind";
import {
  CLIP_TRANSCRIPTION_EVENTS,
  transcribeClipsJobKind,
} from "./transcribe-clips";

let testDb: TestDb;
let dbLayer: Layer.Layer<ClipOperationsService | JobOperationsService>;
let videoId: string;

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;
  dbLayer = Layer.mergeAll(
    ClipOperationsService.Default,
    JobOperationsService.Default
  ).pipe(Layer.provide(Layer.succeed(DrizzleService, testDb as never)));
});

beforeEach(async () => {
  await truncateAllTables(testDb);
  const seeded = await seedCourseVersion(testDb, [
    { path: "01-intro", videos: [{}] },
  ]);
  videoId = Object.values(seeded.videoIds)[0]!;
});

/** Whisper, faked: counts its calls, and never answers for a hung file. */
const calls: string[] = [];
let hang = new Set<string>();
const countingWhisper = Layer.succeed(WhisperTranscriptionService, {
  transcribeClips: (clips: ReadonlyArray<{ id: string; inputVideo: string }>) =>
    Effect.suspend(() => {
      calls.push(clips[0]!.inputVideo);
      return hang.has(clips[0]!.inputVideo)
        ? Effect.never
        : Effect.succeed(
            clips.map((clip) => ({
              id: clip.id,
              words: [{ start: 0, end: 1, text: "w" }],
              segments: [{ start: 0, end: 1, text: `said ${clip.inputVideo}` }],
            }))
          );
    }),
} as unknown as WhisperTranscriptionService);

const layer = () =>
  Layer.mergeAll(
    dbLayer,
    countingWhisper,
    NodeContext.layer,
    SidecarContextTest
  );

const seedClips = async (...inputVideos: string[]) => {
  const rows = await testDb
    .insert(schema.clips)
    .values(
      inputVideos.map((videoFilename, i) => ({
        videoId,
        videoFilename,
        sourceStartTime: i * 10,
        sourceEndTime: i * 10 + 5,
        order: `a${i}`,
        text: "",
        transcriptionStatus: "queued" as const,
      }))
    )
    .returning();
  return rows.map((row) => row.id);
};

const status = async (id: string) =>
  (await testDb.query.clips.findFirst({ where: (t, { eq }) => eq(t.id, id) }))!
    .transcriptionStatus;

const enqueueJob = (clipIds: string[]) =>
  Effect.runPromise(
    Effect.flatMap(JobOperationsService, (ops) =>
      ops.enqueueJob({
        id: null,
        kind: "transcribe-clips",
        title: "Transcribe",
        lane: "default",
        params: { clipIds },
        maxAttempts: 1,
        dependsOn: null,
        subject: { type: "video", id: videoId },
      })
    ).pipe(Effect.provide(dbLayer))
  );

/**
 * One run of the Job, in the background, writing its Job Events to the
 * table as the sidecar does. `ready` resolves once `untilSettled` Clips have
 * settled (or, for 0, once the run has started its Clips).
 */
const startRun = (jobId: string, clipIds: string[], untilSettled: number) => {
  const events: { type: string; data: Record<string, unknown> }[] = [];
  let settled = 0;
  let resolveReady!: () => void;
  const ready = new Promise<void>((r) => (resolveReady = r));
  const ctx: JobContext = {
    jobId,
    attempt: 1,
    maxAttempts: 1,
    enqueue: () => Effect.die("this kind starts no other Job"),
    emit: (type, data) =>
      Effect.flatMap(JobOperationsService, (ops) =>
        ops.appendJobEvent({ jobId, type, data })
      ).pipe(
        Effect.orDie,
        Effect.provide(dbLayer),
        Effect.tap(() =>
          Effect.sync(() => {
            events.push({ type, data });
            if (type === CLIP_TRANSCRIPTION_EVENTS.clipSettled) settled++;
            if (
              type === CLIP_TRANSCRIPTION_EVENTS.clipsStarted &&
              untilSettled === 0
            )
              setTimeout(resolveReady, 50);
            if (settled === untilSettled && untilSettled > 0) resolveReady();
          })
        )
      ),
  };
  const fiber = Effect.runFork(
    transcribeClipsJobKind
      .runRaw({ clipIds }, ctx)
      .pipe(Effect.provide(layer()))
  );
  return { fiber, ready, events };
};

describe("a transcribe-clips Job put back by a deliberate stop", () => {
  it("runs again only the Clips its first run had not settled", async () => {
    calls.length = 0;
    const [a, b] = await seedClips("a.mp4", "b.mp4");
    const job = await enqueueJob([a!, b!]);

    // Run 1: a lands, b is mid-Whisper when the sidecar is stopped on purpose.
    hang = new Set(["b.mp4"]);
    const run1 = startRun(job.id, [a!, b!], 1);
    await run1.ready;
    expect(await status(a!)).toBe("done");
    await Effect.runPromise(Fiber.interrupt(run1.fiber));

    // The Job goes back to the queue with the same params: run 2 is told
    // both Clips again.
    hang = new Set();
    const run2 = startRun(job.id, [a!, b!], 1);
    await run2.ready;
    await Effect.runPromise(Fiber.join(run2.fiber));

    expect(calls.filter((c) => c === "a.mp4")).toHaveLength(1);
    expect(calls.filter((c) => c === "b.mp4")).toHaveLength(2);
    expect(await status(a!)).toBe("done");
    expect(await status(b!)).toBe("done");
    // The second run names only the Clip it took on.
    expect(run2.events[0]).toEqual({
      type: CLIP_TRANSCRIPTION_EVENTS.clipsStarted,
      data: { clipIds: [b] },
    });
  });

  it("does nothing when every Clip already settled", async () => {
    calls.length = 0;
    hang = new Set();
    const [a] = await seedClips("a.mp4");
    const job = await enqueueJob([a!]);

    await Effect.runPromise(Fiber.join(startRun(job.id, [a!], 1).fiber));
    const again = startRun(job.id, [a!], 1);
    await Effect.runPromise(Fiber.join(again.fiber));

    expect(calls).toEqual(["a.mp4"]);
    expect(again.events).toEqual([]);
  });
});
