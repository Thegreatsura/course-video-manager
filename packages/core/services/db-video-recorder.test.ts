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

const addClip = (videoId: string, archived = false) =>
  Effect.promise(() =>
    testDb.insert(schema.clips).values({
      videoId,
      videoFilename: "/footage/obs.mp4",
      sourceStartTime: 0,
      sourceEndTime: 5,
      order: "a0",
      text: "",
      archived,
    })
  );

const addRecordingSession = (
  videoId: string,
  status: "recording" | "stopped"
) =>
  Effect.promise(() =>
    testDb.insert(schema.recordingSessions).values({
      videoId,
      cameraFilePath: "/footage/camera.mkv",
      screenFilePath: "/footage/screen.mkv",
      micFilePath: "/footage/mic.wav",
      status,
    })
  );

const pickNewRecorder = (videoId: string) =>
  Effect.gen(function* () {
    const videoOps = yield* VideoOperationsService;
    return yield* Effect.flip(
      videoOps.updateVideoRecorder({ videoId, recorder: "new-recorder" })
    );
  });

describe("the Video's Recorder", () => {
  it.effect("a new Video takes the Recorder it is created with", () =>
    Effect.gen(function* () {
      const videoOps = yield* VideoOperationsService;
      const video = yield* videoOps.createStandaloneVideo({
        title: "Landscape",
        format: "landscape",
        recorder: "new-recorder",
      });
      expect(video.recorder).toBe("new-recorder");
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("a new Short is always OBS", () =>
    Effect.gen(function* () {
      const videoOps = yield* VideoOperationsService;
      const video = yield* videoOps.createStandaloneVideo({
        title: "Short",
        format: "short",
        recorder: "new-recorder",
      });
      expect(video.recorder).toBeNull();
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("choosing a Recorder persists it on a Video with no Clips", () =>
    Effect.gen(function* () {
      const videoOps = yield* VideoOperationsService;
      const video = yield* videoOps.createStandaloneVideo({
        title: "Landscape",
        format: "landscape",
      });
      yield* videoOps.updateVideoRecorder({
        videoId: video.id,
        recorder: "new-recorder",
      });
      const reread = yield* videoOps.getVideoRowById(video.id);
      expect(reread.recorder).toBe("new-recorder");
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("the Recorder is locked once the Video has a Clip", () =>
    Effect.gen(function* () {
      const videoOps = yield* VideoOperationsService;
      const video = yield* videoOps.createStandaloneVideo({
        title: "Landscape",
        format: "landscape",
      });
      yield* addClip(video.id);
      const error = yield* Effect.flip(
        videoOps.updateVideoRecorder({
          videoId: video.id,
          recorder: "new-recorder",
        })
      );
      expect(error._tag).toBe("VideoRecorderLockedError");
      const reread = yield* videoOps.getVideoRowById(video.id);
      expect(reread.recorder).toBeNull();
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("a Short is never given the New recorder", () =>
    Effect.gen(function* () {
      const videoOps = yield* VideoOperationsService;
      const video = yield* videoOps.createStandaloneVideo({
        title: "Short",
        format: "short",
      });
      const error = yield* Effect.flip(
        videoOps.updateVideoRecorder({
          videoId: video.id,
          recorder: "new-recorder",
        })
      );
      expect(error._tag).toBe("VideoRecorderLockedError");
    }).pipe(Effect.provide(testLayer))
  );

  it.effect(
    "an archived Clip locks the Recorder too, since it can be restored",
    () =>
      Effect.gen(function* () {
        const videoOps = yield* VideoOperationsService;
        const video = yield* videoOps.createStandaloneVideo({
          title: "Landscape",
          format: "landscape",
        });
        yield* addClip(video.id, true);
        const error = yield* pickNewRecorder(video.id);
        expect(error._tag).toBe("VideoRecorderLockedError");
      }).pipe(Effect.provide(testLayer))
  );

  it.effect("a Recording Session still recording locks the Recorder", () =>
    Effect.gen(function* () {
      const videoOps = yield* VideoOperationsService;
      const video = yield* videoOps.createStandaloneVideo({
        title: "Landscape",
        format: "landscape",
        recorder: "new-recorder",
      });
      yield* addRecordingSession(video.id, "recording");
      const error = yield* Effect.flip(
        videoOps.updateVideoRecorder({ videoId: video.id, recorder: "obs" })
      );
      expect(error._tag).toBe("VideoRecorderLockedError");
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("changing a Video to a Short drops the New recorder", () =>
    Effect.gen(function* () {
      const videoOps = yield* VideoOperationsService;
      const video = yield* videoOps.createStandaloneVideo({
        title: "Landscape",
        format: "landscape",
        recorder: "new-recorder",
      });
      const updated = yield* videoOps.updateVideoFormat({
        videoId: video.id,
        format: "short",
      });
      expect(updated.recorder).toBeNull();
    }).pipe(Effect.provide(testLayer))
  );
});
