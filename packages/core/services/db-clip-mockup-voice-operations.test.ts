import { describe, it, expect } from "@effect/vitest";
import { beforeAll, beforeEach } from "vitest";
import { Effect, Layer } from "effect";
import { eq } from "drizzle-orm";
import { ClipMockupOperationsService } from "./db-clip-mockup-operations.server.js";
import { ClipMockupVoiceOperationsService } from "./db-clip-mockup-voice-operations.server.js";
import { DrizzleService } from "./drizzle-service.server.js";
import { clipMockups, videos } from "../db/schema.js";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "../test-utils/pglite.js";

// ===========================================================================
// What the `clip-mockup-voice` Job writes once the row exists: ready with its
// speech, or failed with its reason — and never for words the row no longer
// says.
// ===========================================================================

let testDb: TestDb;
let testLayer: Layer.Layer<
  ClipMockupOperationsService | ClipMockupVoiceOperationsService
>;

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;
  testLayer = Layer.mergeAll(
    ClipMockupOperationsService.Default,
    ClipMockupVoiceOperationsService.Default
  ).pipe(Layer.provide(Layer.succeed(DrizzleService, testDb as any)));
});

beforeEach(async () => {
  await truncateAllTables(testDb);
});

const createPending = (line: string) =>
  Effect.gen(function* () {
    yield* Effect.promise(() =>
      testDb.insert(videos).values({
        id: "video-1",
        lineageId: "lineage-1",
        title: "video-1.mp4",
        originalFootagePath: "/footage/video-1",
      })
    );
    const ops = yield* ClipMockupOperationsService;
    const [row] = yield* ops.createClipMockups("video-1", [
      { type: "clipMockup", line, imagePath: "a.png" },
    ]);
    if (row?.type !== "clipMockup") throw new Error("expected a Clip Mockup");
    return row;
  });

describe("ClipMockupVoiceOperationsService", () => {
  it.effect("lists a Clip Mockup with its Video's lineageId", () =>
    Effect.gen(function* () {
      const row = yield* createPending("Say this.");
      const voice = yield* ClipMockupVoiceOperationsService;

      const listed = yield* voice.listClipMockupsToVoice([row.id, "nope"]);

      expect(listed).toEqual([
        {
          id: row.id,
          line: "Say this.",
          voiceStatus: "pending",
          archived: false,
          lineageId: "lineage-1",
        },
      ]);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("marks a voice ready with its speech", () =>
    Effect.gen(function* () {
      const row = yield* createPending("Say this.");
      const voice = yield* ClipMockupVoiceOperationsService;

      const landed = yield* voice.markVoiceReady({
        id: row.id,
        line: "Say this.",
        speech: { audioPath: "speech-1.wav", durationSeconds: 2.25 },
      });

      expect(landed).toBe(true);
      const after =
        yield* (yield* ClipMockupOperationsService).getClipMockupById(row.id);
      expect(after.voiceStatus).toBe("ready");
      expect(after.audioPath).toBe("speech-1.wav");
      expect(after.durationSeconds).toBe(2.25);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("never marks ready a row whose words changed meanwhile", () =>
    Effect.gen(function* () {
      const row = yield* createPending("Old words.");
      const ops = yield* ClipMockupOperationsService;
      yield* ops.updateClipMockups([
        { id: row.id, say: { line: "New words." } },
      ]);
      const voice = yield* ClipMockupVoiceOperationsService;

      const landed = yield* voice.markVoiceReady({
        id: row.id,
        line: "Old words.",
        speech: { audioPath: "old.wav", durationSeconds: 1 },
      });

      expect(landed).toBe(false);
      const after = yield* ops.getClipMockupById(row.id);
      expect(after.voiceStatus).toBe("pending");
      expect(after.audioPath).toBeNull();
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("marks a voice failed with its reason, but never a ready one", () =>
    Effect.gen(function* () {
      const row = yield* createPending("Say this.");
      const voice = yield* ClipMockupVoiceOperationsService;

      expect(
        yield* voice.markVoiceFailed({
          id: row.id,
          line: "Say this.",
          error: "the GPU would not load",
        })
      ).toBe(true);
      const failed =
        yield* (yield* ClipMockupOperationsService).getClipMockupById(row.id);
      expect(failed.voiceStatus).toBe("failed");
      expect(failed.voiceError).toBe("the GPU would not load");

      yield* Effect.promise(() =>
        testDb
          .update(clipMockups)
          .set({ voiceStatus: "ready", audioPath: "a.wav", durationSeconds: 1 })
          .where(eq(clipMockups.id, row.id))
      );
      expect(
        yield* voice.markVoiceFailed({
          id: row.id,
          line: "Say this.",
          error: "late",
        })
      ).toBe(false);
    }).pipe(Effect.provide(testLayer))
  );
});
