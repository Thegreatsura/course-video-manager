import { describe, it, expect } from "@effect/vitest";
import { beforeAll, beforeEach } from "vitest";
import { Effect, Layer } from "effect";
import { ClipOperationsService } from "./db-clip-operations.server.js";
import { VideoOperationsService } from "./db-video-operations.server.js";
import { DrizzleService } from "./drizzle-service.server.js";
import * as schema from "../db/schema.js";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "../test-utils/pglite.js";

let testDb: TestDb;
let testLayer: Layer.Layer<ClipOperationsService | VideoOperationsService>;

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;

  testLayer = Layer.mergeAll(
    ClipOperationsService.Default,
    VideoOperationsService.Default
  ).pipe(Layer.provide(Layer.succeed(DrizzleService, testDb as any)));
});

describe("moveClipToVideo", () => {
  let sourceVideoId: string;
  let targetVideoId: string;
  let clipCounter = 0;

  const appendClipTo = (videoId: string, afterClipId?: string) =>
    Effect.gen(function* () {
      const clipOps = yield* ClipOperationsService;
      const offset = clipCounter++;
      const [clip] = yield* clipOps.appendClips({
        videoId,
        insertionPoint:
          afterClipId === undefined
            ? { type: "start" }
            : { type: "after-clip", databaseClipId: afterClipId },
        clips: [
          {
            inputVideo: "test.mp4",
            startTime: offset * 10,
            endTime: (offset + 1) * 10,
          },
        ],
      });
      return clip!;
    });

  const timelineIds = (videoId: string) =>
    Effect.gen(function* () {
      const clipOps = yield* ClipOperationsService;
      return (yield* clipOps.listTimelineOrder(videoId)).map((i) => i.id);
    });

  const moveClipToVideo = (
    clipId: string,
    videoId: string,
    beforeItemId: string | null
  ) =>
    Effect.gen(function* () {
      const clipOps = yield* ClipOperationsService;
      return yield* clipOps.moveClipToVideo(clipId, videoId, beforeItemId);
    });

  beforeEach(async () => {
    clipCounter = 0;
    await truncateAllTables(testDb);

    const [source, target] = await Effect.gen(function* () {
      const videoOps = yield* VideoOperationsService;
      return [
        yield* videoOps.createStandaloneVideo({
          title: "source.mp4",
          format: "landscape",
        }),
        yield* videoOps.createStandaloneVideo({
          title: "target.mp4",
          format: "landscape",
        }),
      ] as const;
    }).pipe(Effect.provide(testLayer), Effect.runPromise);
    sourceVideoId = source.id;
    targetVideoId = target.id;
  });

  it.effect(
    "null beforeItemId appends to the end of the target, keeping every other field",
    () =>
      Effect.gen(function* () {
        const a = yield* appendClipTo(sourceVideoId);
        const b = yield* appendClipTo(sourceVideoId, a.id);
        const t = yield* appendClipTo(targetVideoId);

        const clipOps = yield* ClipOperationsService;
        const before = yield* clipOps.updateClip(a.id, {
          text: "spoken words",
          scene: "Code",
          profile: "Landscape Recording",
        });
        yield* Effect.promise(() =>
          testDb
            .insert(schema.clipTranscriptWords)
            .values({ clipId: a.id, start: 0, end: 0.5, text: "spoken" })
        );

        const moved = yield* moveClipToVideo(a.id, targetVideoId, null);

        expect(moved).toEqual({
          ...before,
          videoId: targetVideoId,
          order: moved.order,
        });
        expect(yield* timelineIds(targetVideoId)).toEqual([t.id, a.id]);
        expect(yield* timelineIds(sourceVideoId)).toEqual([b.id]);
        const words = yield* clipOps.listTranscriptWords(a.id);
        expect(words.map((w) => w.text)).toEqual(["spoken"]);
      }).pipe(Effect.provide(testLayer))
  );

  it.effect("lands immediately before an anchor on the target", () =>
    Effect.gen(function* () {
      const a = yield* appendClipTo(sourceVideoId);
      const t1 = yield* appendClipTo(targetVideoId);
      const t2 = yield* appendClipTo(targetVideoId, t1.id);

      yield* moveClipToVideo(a.id, targetVideoId, t2.id);

      expect(yield* timelineIds(targetVideoId)).toEqual([t1.id, a.id, t2.id]);
      expect(yield* timelineIds(sourceVideoId)).toEqual([]);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("repeated appends keep the source's order on the target", () =>
    Effect.gen(function* () {
      const a = yield* appendClipTo(sourceVideoId);
      const b = yield* appendClipTo(sourceVideoId, a.id);
      const c = yield* appendClipTo(sourceVideoId, b.id);

      for (const id of [a.id, b.id, c.id]) {
        yield* moveClipToVideo(id, targetVideoId, null);
      }

      expect(yield* timelineIds(targetVideoId)).toEqual([a.id, b.id, c.id]);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("an anchor that is not on the target => NotFoundError", () =>
    Effect.gen(function* () {
      const a = yield* appendClipTo(sourceVideoId);
      const b = yield* appendClipTo(sourceVideoId, a.id);

      const error = yield* moveClipToVideo(a.id, targetVideoId, b.id).pipe(
        Effect.flip
      );

      expect(error._tag).toBe("NotFoundError");
      expect(yield* timelineIds(sourceVideoId)).toEqual([a.id, b.id]);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("an unknown target video => NotFoundError", () =>
    Effect.gen(function* () {
      const a = yield* appendClipTo(sourceVideoId);

      const error = yield* moveClipToVideo(a.id, "no-such-video", null).pipe(
        Effect.flip
      );

      expect(error._tag).toBe("NotFoundError");
    }).pipe(Effect.provide(testLayer))
  );

  it.effect(
    "a clip anchoring an Overlay => ClipCarriesOverlaysError, nothing moves",
    () =>
      Effect.gen(function* () {
        const a = yield* appendClipTo(sourceVideoId);
        yield* Effect.promise(() =>
          testDb.insert(schema.overlays).values({
            clipId: a.id,
            at: 1,
            durationInSeconds: 2,
            title: "Term",
            description: "Definition",
          })
        );

        const error = yield* moveClipToVideo(a.id, targetVideoId, null).pipe(
          Effect.flip
        );

        expect(error._tag).toBe("ClipCarriesOverlaysError");
        expect(yield* timelineIds(sourceVideoId)).toEqual([a.id]);
        expect(yield* timelineIds(targetVideoId)).toEqual([]);
      }).pipe(Effect.provide(testLayer))
  );
});
