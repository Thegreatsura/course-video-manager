import { describe, it, expect } from "@effect/vitest";
import { beforeAll, beforeEach } from "vitest";
import { ConfigProvider, Effect, Layer } from "effect";
import { NodeContext } from "@effect/platform-node";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { WhisperTranscriptionService } from "@/services/whisper-transcription-service";
import { LocalWhisperUnavailable } from "@/services/local-whisper-engine";
import { FFmpegCommandsService } from "@/services/ffmpeg-commands";
import { FFmpegEncodeService } from "@/services/ffmpeg-encode-commands";
import { DrizzleService } from "@/services/drizzle-service.server";
import { ClipOperationsService } from "@/services/db-clip-operations.server";
import {
  VideoEditorLoggerService,
  type LogEvent,
} from "@/services/video-editor-logger-service";
import * as schema from "@/db/schema";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/pglite";
import {
  buildSubtitles,
  RenderVerticalError,
  RenderVerticalVideoService,
} from "./render-vertical-video-service";
import { SidecarContextTest } from "./sidecar-context";

describe("buildSubtitles", () => {
  it("keeps a short segment as a single subtitle and converts to frames", () => {
    // "Hello world" is 11 chars (<= 32), so it passes through untouched.
    const segments = [{ start: 0, end: 1, text: "Hello world" }];

    const result = buildSubtitles(segments, 60);

    expect(result).toEqual([
      { startFrame: 0, endFrame: 60, text: "Hello world" },
    ]);
  });

  it("splits a long segment into phrases with evenly divided timing", () => {
    // 43 chars > 32 → numChunks = ceil(43/32) = 2; 9 words →
    // wordsPerChunk = ceil(9/2) = 5. Duration 10s / 2 = 5s per chunk.
    const segments = [
      {
        start: 0,
        end: 10,
        text: "The quick brown fox jumps over the lazy dog",
      },
    ];

    const result = buildSubtitles(segments, 1);

    expect(result).toEqual([
      { startFrame: 0, endFrame: 5, text: "The quick brown fox jumps" },
      { startFrame: 5, endFrame: 10, text: "over the lazy dog" },
    ]);
  });

  it("flattens multiple segments and trims Whisper's leading spaces", () => {
    // Whisper segment text is typically prefixed with a space; floor() is used
    // for the seconds → frames conversion.
    const segments = [
      { start: 0, end: 0.9, text: " Hi there" },
      { start: 1, end: 2, text: " again" },
    ];

    const result = buildSubtitles(segments, 1);

    expect(result).toEqual([
      { startFrame: 0, endFrame: 0, text: "Hi there" },
      { startFrame: 1, endFrame: 2, text: "again" },
    ]);
  });

  it("returns an empty array when there are no segments", () => {
    expect(buildSubtitles([], 60)).toEqual([]);
  });
});

describe("RenderVerticalVideoService", () => {
  let testDb: TestDb;

  beforeAll(async () => {
    const result = await createTestDb();
    testDb = result.testDb;
  });

  beforeEach(async () => {
    await truncateAllTables(testDb);
  });

  function buildTestLayer(overrides?: {
    exportResult?: string;
    getFpsResult?: number;
  }) {
    const dbLayer = Layer.succeed(DrizzleService, testDb as any);

    const fakeWhisper = Layer.succeed(WhisperTranscriptionService, {
      transcribeVideoFile: () =>
        Effect.succeed({
          words: [
            { start: 0, end: 0.5, text: "hello" },
            { start: 0.6, end: 1.0, text: "world" },
          ],
          segments: [{ start: 0, end: 1.0, text: "hello world" }],
        }),
      exportVideoClips: () =>
        Effect.succeed(overrides?.exportResult ?? "/tmp/fake-concatenated.mp4"),
    } as any);

    const fakeFfmpeg = Layer.succeed(FFmpegCommandsService, {
      getFPS: () => Effect.succeed(overrides?.getFpsResult ?? 60),
    } as any);

    const configLayer = Layer.setConfigProvider(
      ConfigProvider.fromMap(
        new Map([["STORAGE_ROOTS", "/tmp/test-storage-root"]])
      )
    );

    const depsLayer = Layer.mergeAll(
      VideoOperationsService.Default.pipe(Layer.provide(dbLayer)),
      ClipOperationsService.Default.pipe(Layer.provide(dbLayer)),
      fakeWhisper,
      fakeFfmpeg,
      Layer.succeed(FFmpegEncodeService, {} as any),
      configLayer,
      NodeContext.layer
    );

    return Layer.mergeAll(
      depsLayer,
      // A render runs only in the Sidecar; a test stands in for it.
      SidecarContextTest,
      RenderVerticalVideoService.Default.pipe(
        Layer.provide(Layer.merge(depsLayer, LocalWhisperUnavailable))
      )
    );
  }

  it.effect("rejects when video has no clips", () =>
    Effect.gen(function* () {
      const [video] = yield* Effect.promise(() =>
        testDb
          .insert(schema.videos)
          .values({
            title: "Empty Short",
            originalFootagePath: "/footage/empty.mp4",
            format: "short",
          })
          .returning()
      );

      const service = yield* RenderVerticalVideoService;
      const result = yield* service
        .renderVerticalVideo({ videoId: video!.id })
        .pipe(Effect.flip);

      expect(result._tag).toBe("RenderVerticalError");
    }).pipe(Effect.provide(buildTestLayer()))
  );

  it.effect("rejects when video does not exist", () =>
    Effect.gen(function* () {
      const service = yield* RenderVerticalVideoService;
      const result = yield* service
        .renderVerticalVideo({ videoId: "nonexistent-id" })
        .pipe(Effect.flip);

      expect(result._tag).toBe("NotFoundError");
    }).pipe(Effect.provide(buildTestLayer()))
  );

  it.effect(
    "records a failed stage in the video's own log, not only the SSE error",
    () => {
      const logged: { videoId: string; event: LogEvent }[] = [];

      const dbLayer = Layer.succeed(DrizzleService, testDb as any);
      const depsLayer = Layer.mergeAll(
        VideoOperationsService.Default.pipe(Layer.provide(dbLayer)),
        Layer.succeed(WhisperTranscriptionService, {} as any),
        Layer.succeed(FFmpegCommandsService, {} as any),
        Layer.succeed(FFmpegEncodeService, {
          createAndConcatenateVideoClipsSinglePass: () =>
            Effect.fail(
              new RenderVerticalError({
                cause: null,
                message: "ffmpeg concat blew up",
              })
            ),
        } as any),
        Layer.succeed(VideoEditorLoggerService, {
          log: (videoId: string, event: LogEvent) =>
            Effect.sync(() => {
              logged.push({ videoId, event });
            }),
          getLogPath: () => "/dev/null",
        } as any),
        Layer.setConfigProvider(
          ConfigProvider.fromMap(
            new Map([["STORAGE_ROOTS", "/tmp/test-storage-root"]])
          )
        ),
        NodeContext.layer
      );

      return Effect.gen(function* () {
        const [video] = yield* Effect.promise(() =>
          testDb
            .insert(schema.videos)
            .values({
              title: "Broken Short",
              originalFootagePath: "/footage/short.mp4",
              format: "short",
            })
            .returning()
        );
        yield* Effect.promise(() =>
          testDb.insert(schema.clips).values({
            videoId: video!.id,
            videoFilename: "/footage/a.mp4",
            sourceStartTime: 0,
            sourceEndTime: 10,
            order: "0001",
            text: "hello",
          })
        );

        const service = yield* RenderVerticalVideoService;
        const error = yield* service
          .renderVerticalVideo({ videoId: video!.id })
          .pipe(Effect.flip);

        expect(error.message).toBe("ffmpeg concat blew up");
        expect(logged).toEqual([
          {
            videoId: video!.id,
            event: expect.objectContaining({
              type: "export-stage-failed",
              stage: "short:concatenating-clips",
              message: "ffmpeg concat blew up",
            }),
          },
        ]);
      }).pipe(
        Effect.provide(
          RenderVerticalVideoService.DefaultWithoutDependencies.pipe(
            Layer.provide(depsLayer)
          )
        ),
        // The overlay step spawns a subprocess, so the render itself (not just
        // the service's construction) needs a CommandExecutor in context.
        // A render runs only in the Sidecar; a test stands in for it.
        Effect.provide(Layer.merge(NodeContext.layer, SidecarContextTest))
      );
    }
  );

  it.effect(
    "renders a CVM-recorder Clip as its composite, through the Clip Source",
    () => {
      const segmentCalls: unknown[] = [];
      const singlePassCalls: unknown[] = [];
      const stop = new RenderVerticalError({ cause: null, message: "stop" });

      const dbLayer = Layer.succeed(DrizzleService, testDb as any);
      const depsLayer = Layer.mergeAll(
        VideoOperationsService.Default.pipe(Layer.provide(dbLayer)),
        Layer.succeed(WhisperTranscriptionService, {} as any),
        Layer.succeed(FFmpegCommandsService, {} as any),
        Layer.succeed(FFmpegEncodeService, {
          concatenateClipSegments: (clips: unknown) => {
            segmentCalls.push(clips);
            return Effect.fail(stop);
          },
          createAndConcatenateVideoClipsSinglePass: (clips: unknown) => {
            singlePassCalls.push(clips);
            return Effect.fail(stop);
          },
        } as any),
        Layer.succeed(VideoEditorLoggerService, {
          log: () => Effect.void,
        } as any),
        Layer.setConfigProvider(
          ConfigProvider.fromMap(
            new Map([["STORAGE_ROOTS", "/tmp/test-storage-root"]])
          )
        ),
        NodeContext.layer
      );

      return Effect.gen(function* () {
        const [video] = yield* Effect.promise(() =>
          testDb
            .insert(schema.videos)
            .values({
              title: "Short",
              originalFootagePath: "/rec",
              format: "short",
            })
            .returning()
        );
        const [session] = yield* Effect.promise(() =>
          testDb
            .insert(schema.recordingSessions)
            .values({
              videoId: video!.id,
              cameraFilePath: "/rec/s1/camera.mkv",
              screenFilePath: "/rec/s1/screen.mkv",
              micFilePath: "/rec/s1/mic.mkv",
            })
            .returning()
        );
        yield* Effect.promise(() =>
          testDb.insert(schema.clips).values({
            videoId: video!.id,
            videoFilename: "/rec/s1/mic.mkv",
            sourceStartTime: 2,
            sourceEndTime: 6,
            order: "a0",
            text: "hello",
            recordingSessionId: session!.id,
            sceneOverride: "Code",
          })
        );

        const service = yield* RenderVerticalVideoService;
        yield* service
          .renderVerticalVideo({ videoId: video!.id })
          .pipe(Effect.flip);

        expect(singlePassCalls).toEqual([]);
        expect(segmentCalls).toEqual([
          [
            expect.objectContaining({
              startTime: 1.85,
              duration: 4,
              composite: expect.objectContaining({
                start: 2,
                screen: "/rec/s1/screen.mkv",
                camera: "/rec/s1/camera.mkv",
                mic: "/rec/s1/mic.mkv",
                segments: [{ scene: "Code", startSeconds: 2, endSeconds: 6 }],
              }),
            }),
          ],
        ]);
      }).pipe(
        Effect.provide(
          RenderVerticalVideoService.DefaultWithoutDependencies.pipe(
            Layer.provide(depsLayer)
          )
        ),
        Effect.provide(Layer.merge(NodeContext.layer, SidecarContextTest))
      );
    }
  );
});
