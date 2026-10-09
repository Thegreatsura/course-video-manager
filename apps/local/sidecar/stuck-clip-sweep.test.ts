import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Effect, Layer } from "effect";
import { eq } from "drizzle-orm";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/pglite";
import { ClipOperationsService } from "@/services/db-clip-operations.server";
import { DrizzleService } from "@/services/drizzle-service.server";
import * as schema from "@cvm/core/db/schema";
import type { JobStatus } from "@cvm/core/db/schema-jobs";
import { seedCourseVersion } from "@/test-utils/autofill-service-test-setup";
import { sweepStuckClips } from "./stuck-clip-sweep";

let testDb: TestDb;
let dbLayer: Layer.Layer<ClipOperationsService>;

beforeAll(async () => {
  testDb = (await createTestDb()).testDb;
  dbLayer = ClipOperationsService.Default.pipe(
    Layer.provide(Layer.succeed(DrizzleService, testDb as never))
  );
});

beforeEach(async () => {
  await truncateAllTables(testDb);
});

const seedVideo = async (
  commitState: "draft" | "pending" | "published" = "draft"
) => {
  const seeded = await seedCourseVersion(
    testDb,
    [{ path: "01-intro", videos: [{}] }],
    { commitState }
  );
  return Object.values(seeded.videoIds)[0]!;
};

const seedClips = async (
  videoId: string,
  statuses: ReadonlyArray<"queued" | "transcribing" | "failed" | "done">
) => {
  const rows = await testDb
    .insert(schema.clips)
    .values(
      statuses.map((transcriptionStatus, i) => ({
        videoId,
        videoFilename: `clip-${i}.mp4`,
        sourceStartTime: i * 10,
        sourceEndTime: i * 10 + 5,
        order: `a${i}`,
        text: "",
        transcriptionStatus,
      }))
    )
    .returning();
  return rows.map((row) => row.id);
};

const seedJob = async (
  clipIds: string[],
  status: JobStatus,
  kind = "transcribe-clips"
) => {
  await testDb.insert(schema.jobs).values({
    kind,
    title: "Transcribe",
    lane: "default",
    params: { clipIds },
    status,
    maxAttempts: 1,
  });
};

const status = async (id: string) =>
  (await testDb.query.clips.findFirst({ where: eq(schema.clips.id, id) }))!
    .transcriptionStatus;

const jobCount = async () => (await testDb.select().from(schema.jobs)).length;

const sweep = () =>
  Effect.runPromise(sweepStuckClips.pipe(Effect.provide(dbLayer)));

describe("the stuck-Clip sweep", () => {
  it("fails a Clip left transcribing with no Job, and enqueues nothing", async () => {
    const videoId = await seedVideo();
    const [stuck] = await seedClips(videoId, ["transcribing"]);

    await sweep();

    expect(await status(stuck!)).toBe("failed");
    expect(await jobCount()).toBe(0);
  });

  it("leaves a Clip a queued or running transcribe-clips Job holds", async () => {
    const videoId = await seedVideo();
    const [byQueued, byRunning, stuck] = await seedClips(videoId, [
      "transcribing",
      "transcribing",
      "transcribing",
    ]);
    await seedJob([byQueued!], "queued");
    await seedJob(["someone-else", byRunning!], "running");

    await sweep();

    expect(await status(byQueued!)).toBe("transcribing");
    expect(await status(byRunning!)).toBe("transcribing");
    expect(await status(stuck!)).toBe("failed");
    expect(await jobCount()).toBe(2);
  });

  it("fails a Clip whose Job has ended, or that only another kind's live Job names", async () => {
    const videoId = await seedVideo();
    const [byFailed, byInterrupted, byOtherKind] = await seedClips(videoId, [
      "transcribing",
      "transcribing",
      "transcribing",
    ]);
    await seedJob([byFailed!], "failed");
    await seedJob([byInterrupted!], "interrupted");
    await seedJob([byOtherKind!], "running", "noop");

    await sweep();

    expect(await status(byFailed!)).toBe("failed");
    expect(await status(byInterrupted!)).toBe("failed");
    expect(await status(byOtherKind!)).toBe("failed");
  });

  it("leaves queued, done and failed Clips alone", async () => {
    const videoId = await seedVideo();
    const ids = await seedClips(videoId, ["queued", "done", "failed"]);

    await sweep();

    expect(await Promise.all(ids.map(status))).toEqual([
      "queued",
      "done",
      "failed",
    ]);
  });

  it("never writes to a Pending or Published Version", async () => {
    const published = await seedVideo("published");
    const pending = await seedVideo("pending");
    const [inPublished] = await seedClips(published, ["transcribing"]);
    const [inPending] = await seedClips(pending, ["transcribing"]);

    await sweep();

    expect(await status(inPublished!)).toBe("transcribing");
    expect(await status(inPending!)).toBe("transcribing");
  });

  it("fails a stuck Clip of a Video in no Version (a standalone Video)", async () => {
    const [video] = await testDb
      .insert(schema.videos)
      .values({ title: "Standalone", originalFootagePath: "/x.mp4" })
      .returning();
    const [stuck] = await seedClips(video!.id, ["transcribing"]);

    await sweep();

    expect(await status(stuck!)).toBe("failed");
  });

  it("run twice, fails each stuck Clip once and still enqueues nothing", async () => {
    const videoId = await seedVideo();
    const [stuck, held] = await seedClips(videoId, [
      "transcribing",
      "transcribing",
    ]);
    await seedJob([held!], "running");

    await sweep();
    await sweep();

    expect(await status(stuck!)).toBe("failed");
    expect(await status(held!)).toBe("transcribing");
    expect(await jobCount()).toBe(1);
  });
});
