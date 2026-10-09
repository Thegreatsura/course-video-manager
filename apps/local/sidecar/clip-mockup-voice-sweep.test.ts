import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Effect, Layer } from "effect";
import { and, eq, inArray } from "drizzle-orm";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/pglite";
import { DrizzleService } from "@/services/drizzle-service.server";
import { JobOperationsService } from "@cvm/core/services/db-job-operations.server";
import { ClipMockupVoiceOperationsService } from "@/services/db-clip-mockup-voice-operations.server";
import { VersionOperationsService } from "@/services/db-version-operations.server";
import * as schema from "@cvm/core/db/schema";
import { seedCourseVersion } from "@/test-utils/autofill-service-test-setup";
import { sweepUnqueuedVoices } from "./clip-mockup-voice-sweep";

// ===========================================================================
// A copied Clip Mockup is a new row, with a new id, that no voice Job names:
// copying a Version (or a Course, or a Video) must not leave one `pending`
// for ever. A ready one carries its WAV across; the Sidecar's sweep queues a
// Job for the rest.
// ===========================================================================

let testDb: TestDb;
let layer: Layer.Layer<
  | JobOperationsService
  | ClipMockupVoiceOperationsService
  | VersionOperationsService
>;

beforeAll(async () => {
  testDb = (await createTestDb()).testDb;
  layer = Layer.mergeAll(
    JobOperationsService.Default,
    ClipMockupVoiceOperationsService.Default,
    VersionOperationsService.Default
  ).pipe(Layer.provide(Layer.succeed(DrizzleService, testDb as never)));
});

beforeEach(async () => {
  await truncateAllTables(testDb);
});

const run = <A, E>(
  effect: Effect.Effect<
    A,
    E,
    | JobOperationsService
    | ClipMockupVoiceOperationsService
    | VersionOperationsService
  >
) => Effect.runPromise(effect.pipe(Effect.provide(layer)));

describe("copying a Version's Clip Mockups", () => {
  it("keeps a ready voice's WAV, and queues a Job for one not ready", async () => {
    const { courseId, versionId, videoIds } = await seedCourseVersion(testDb, [
      { path: "01-intro", videos: [{}] },
    ]);
    const videoId = Object.values(videoIds)[0]!;
    await testDb.insert(schema.clipMockups).values([
      {
        videoId,
        line: "Voiced already.",
        imagePath: "a.png",
        audioPath: "speech-a.wav",
        durationSeconds: 2,
        voiceStatus: "ready",
        order: "a0",
      },
      {
        videoId,
        line: "Still being voiced.",
        imagePath: "b.png",
        voiceStatus: "pending",
        order: "a1",
      },
    ]);

    const { version } = await run(
      Effect.flatMap(VersionOperationsService, (ops) =>
        ops.copyVersionStructure({
          sourceVersionId: versionId,
          repoId: courseId,
          newVersionName: "",
        })
      )
    );
    await run(sweepUnqueuedVoices);

    const copied = await testDb
      .select({
        id: schema.clipMockups.id,
        line: schema.clipMockups.line,
        voiceStatus: schema.clipMockups.voiceStatus,
        audioPath: schema.clipMockups.audioPath,
      })
      .from(schema.clipMockups)
      .innerJoin(
        schema.videos,
        eq(schema.videos.id, schema.clipMockups.videoId)
      )
      .innerJoin(schema.lessons, eq(schema.lessons.id, schema.videos.lessonId))
      .innerJoin(
        schema.sections,
        eq(schema.sections.id, schema.lessons.sectionId)
      )
      .where(eq(schema.sections.repoVersionId, version.id));
    const ready = copied.find((r) => r.line === "Voiced already.")!;
    const pending = copied.find((r) => r.line === "Still being voiced.")!;

    expect(ready).toMatchObject({
      voiceStatus: "ready",
      audioPath: "speech-a.wav",
    });
    const live = await testDb
      .select({ params: schema.jobs.params })
      .from(schema.jobs)
      .where(
        and(
          eq(schema.jobs.kind, "clip-mockup-voice"),
          inArray(schema.jobs.status, ["queued", "running"])
        )
      );
    expect(live.map((j) => j.params)).toEqual([
      {
        clipMockupIds: [pending.id],
        lines: { [pending.id]: "Still being voiced." },
      },
    ]);
  });
});
