import { describe, it, expect } from "@effect/vitest";
import { beforeAll, beforeEach } from "vitest";
import { Effect, Layer } from "effect";
import { VideoOperationsService } from "./db-video-operations.server.js";
import { CourseOperationsService } from "./db-course-operations.server.js";
import { DrizzleService } from "./drizzle-service.server.js";
import * as schema from "../db/schema.js";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "../test-utils/pglite.js";

let testDb: TestDb;
let testLayer: Layer.Layer<VideoOperationsService>;

beforeAll(async () => {
  testDb = (await createTestDb()).testDb;
  const drizzleLayer = Layer.succeed(DrizzleService, testDb as any);
  testLayer = VideoOperationsService.Default.pipe(
    Layer.provide(
      CourseOperationsService.Default.pipe(Layer.provide(drizzleLayer))
    ),
    Layer.provide(drizzleLayer)
  );
});

beforeEach(async () => {
  await truncateAllTables(testDb);
});

const addRecordingSession = (
  videoId: string,
  status: "recording" | "stopped"
) =>
  Effect.promise(async () => {
    const [session] = await testDb
      .insert(schema.recordingSessions)
      .values({
        videoId,
        cameraFilePath: "/footage/camera.mkv",
        screenFilePath: "/footage/screen.mkv",
        micFilePath: "/footage/mic.wav",
        status,
      })
      .returning();
    return session!;
  });

describe("the Video's Recorder", () => {
  it.effect("a new Video takes the Recorder it is created with", () =>
    Effect.gen(function* () {
      const videoOps = yield* VideoOperationsService;
      const video = yield* videoOps.createStandaloneVideo({
        title: "Landscape",
        format: "landscape",
        recorder: "cvm",
      });
      expect(video.recorder).toBe("cvm");
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("a Short records with the CVM recorder only", () =>
    Effect.gen(function* () {
      const videoOps = yield* VideoOperationsService;
      const video = yield* videoOps.createStandaloneVideo({
        title: "Short",
        format: "short",
        recorder: "obs",
      });
      expect(video.recorder).toBe("cvm");
      const error = yield* Effect.flip(
        videoOps.updateVideoRecorder({ videoId: video.id, recorder: "obs" })
      );
      expect(error._tag).toBe("VideoRecorderLockedError");
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("a Recording Session still recording locks the Recorder", () =>
    Effect.gen(function* () {
      const videoOps = yield* VideoOperationsService;
      const video = yield* videoOps.createStandaloneVideo({
        title: "Landscape",
        format: "landscape",
        recorder: "cvm",
      });
      yield* addRecordingSession(video.id, "recording");
      const error = yield* Effect.flip(
        videoOps.updateVideoRecorder({ videoId: video.id, recorder: "obs" })
      );
      expect(error._tag).toBe("VideoRecorderLockedError");
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("changing an OBS Video to a Short opens the CVM recorder", () =>
    Effect.gen(function* () {
      const videoOps = yield* VideoOperationsService;
      const video = yield* videoOps.createStandaloneVideo({
        title: "Landscape",
        format: "landscape",
        recorder: "obs",
      });
      const updated = yield* videoOps.updateVideoFormat({
        videoId: video.id,
        format: "short",
      });
      expect(updated.recorder).toBe("cvm");
    }).pipe(Effect.provide(testLayer))
  );
});
