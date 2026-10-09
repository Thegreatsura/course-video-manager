import { describe, it, expect } from "@effect/vitest";
import { beforeAll, beforeEach } from "vitest";
import { Effect, Layer } from "effect";
import { ClipMockupOperationsService } from "./db-clip-mockup-operations.server.js";
import { DrizzleService } from "./drizzle-service.server.js";
import { eq } from "drizzle-orm";
import { clipMockups, videos } from "../db/schema.js";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "../test-utils/pglite.js";

// ===========================================================================
// The row half of a Clip Mockup. The frame half is in apps/local, and so is
// every test of it — this file only asserts what the database is responsible
// for: the ordering, the archive, and the fields a Clip Mockup must carry.
// ===========================================================================

let testDb: TestDb;
let testLayer: Layer.Layer<ClipMockupOperationsService>;

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;

  testLayer = ClipMockupOperationsService.Default.pipe(
    Layer.provide(Layer.succeed(DrizzleService, testDb as any))
  );
});

beforeEach(async () => {
  await truncateAllTables(testDb);
});

const makeVideo = async (id: string) => {
  await testDb.insert(videos).values({
    id,
    title: `${id}.mp4`,
    originalFootagePath: `/footage/${id}`,
  });
};

/** The measured speech a caller hands over; the service never makes one. */
const speech = (audioPath: string, durationSeconds: number) => ({
  audioPath,
  durationSeconds,
});

/** One Clip Mockup entry of a `createClipMockups` run. */
const moment = (line: string, imagePath: string, durationSeconds = 1) => ({
  type: "clipMockup" as const,
  line,
  imagePath,
  speech: speech(`${imagePath}.wav`, durationSeconds),
});

/** Create one Clip Mockup and hand back its row. */
const createOne = (videoId: string, line: string, imagePath: string) =>
  Effect.flatMap(ClipMockupOperationsService, (ops) =>
    ops.createClipMockups(videoId, [moment(line, imagePath)])
  ).pipe(
    Effect.map(([row]) => {
      if (row?.type !== "clipMockup") throw new Error("expected a Clip Mockup");
      return row;
    })
  );

describe("createClipMockups", () => {
  it.effect("appends in the order given, carrying the measured speech", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => makeVideo("video-1"));
      const ops = yield* ClipMockupOperationsService;

      const created = yield* ops.createClipMockups("video-1", [
        moment("Here's the problem.", "a.png", 2.75),
        moment("And here's the fix.", "b.png", 1.5),
      ]);

      const first = created[0]!;
      expect(first.type).toBe("clipMockup");
      if (first.type !== "clipMockup") return;
      expect(first.line).toBe("Here's the problem.");
      expect(first.imagePath).toBe("a.png");
      expect(first.audioPath).toBe("a.png.wav");
      // A float, never rounded: an Animatic's run time is the sum of these.
      expect(first.durationSeconds).toBe(2.75);
      // Voiced before it is saved, so it is born ready.
      expect(first.voiceStatus).toBe("ready");
      expect(first.voiceError).toBeNull();
      expect(first.archived).toBe(false);

      const rows = yield* ops.listClipMockupsByVideoId("video-1");
      expect(rows.map((r) => r.id)).toEqual(created.map((r) => r.id));
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("appends a second run after the first", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => makeVideo("video-1"));
      const ops = yield* ClipMockupOperationsService;

      const one = yield* ops.createClipMockups("video-1", [
        moment("One", "a.png"),
        moment("Two", "b.png"),
      ]);
      const two = yield* ops.createClipMockups("video-1", [
        moment("Three", "c.png"),
      ]);

      const rows = yield* ops.listClipMockupsByVideoId("video-1");
      expect(rows.map((r) => r.line)).toEqual(["One", "Two", "Three"]);
      expect(rows.map((r) => r.id)).toEqual([...one, ...two].map((r) => r.id));
    }).pipe(Effect.provide(testLayer))
  );

  it.effect(
    "places a Chapter entry between the moments either side of it",
    () =>
      Effect.gen(function* () {
        yield* Effect.promise(() => makeVideo("video-1"));
        const ops = yield* ClipMockupOperationsService;

        const created = yield* ops.createClipMockups("video-1", [
          moment("Before", "a.png"),
          { type: "clipMockupChapter", name: "The fix" },
          moment("After", "b.png"),
        ]);

        expect(created.map((r) => r.type)).toEqual([
          "clipMockup",
          "clipMockupChapter",
          "clipMockup",
        ]);
        const orders = created.map((r) => r.order);
        expect([...orders].sort()).toEqual(orders);
        expect(new Set(orders).size).toBe(3);
      }).pipe(Effect.provide(testLayer))
  );
});

describe("listClipMockupsByVideoId", () => {
  it.effect("excludes archived rows and other Videos' rows", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => makeVideo("video-1"));
      yield* Effect.promise(() => makeVideo("video-2"));
      const ops = yield* ClipMockupOperationsService;

      const kept = yield* createOne("video-1", "Mine", "a.png");
      const gone = yield* createOne("video-1", "Deleted", "b.png");
      yield* createOne("video-2", "Theirs", "c.png");
      yield* ops.deleteClipMockup(gone.id);

      const rows = yield* ops.listClipMockupsByVideoId("video-1");
      expect(rows.map((r) => r.id)).toEqual([kept.id]);

      // Archived == deleted, but the row itself survives for `get` to report.
      const archived = yield* ops.getClipMockupById(gone.id);
      expect(archived.archived).toBe(true);
    }).pipe(Effect.provide(testLayer))
  );
});

describe("updateClipMockups", () => {
  it.effect("replaces the words and their speech in one write", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => makeVideo("video-1"));
      const ops = yield* ClipMockupOperationsService;
      const row = yield* createOne("video-1", "Too long by half.", "a.png");

      const [updated] = yield* ops.updateClipMockups([
        {
          id: row.id,
          say: { line: "Shorter.", speech: speech("new.wav", 1.125) },
        },
      ]);

      expect(updated!.line).toBe("Shorter.");
      expect(updated!.audioPath).toBe("new.wav");
      expect(updated!.durationSeconds).toBe(1.125);
      // The picture is untouched: only the words and their voicing moved.
      expect(updated!.imagePath).toBe("a.png");
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("new words with their speech make a failed voice ready", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => makeVideo("video-1"));
      const ops = yield* ClipMockupOperationsService;
      const row = yield* createOne("video-1", "Broke.", "a.png");
      yield* Effect.promise(() =>
        testDb
          .update(clipMockups)
          .set({ voiceStatus: "failed", voiceError: "Kokoro was down" })
          .where(eq(clipMockups.id, row.id))
      );

      const [updated] = yield* ops.updateClipMockups([
        { id: row.id, say: { line: "Fixed.", speech: speech("f.wav", 1) } },
      ]);

      expect(updated!.voiceStatus).toBe("ready");
      expect(updated!.voiceError).toBeNull();
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("swaps a frame and leaves the line alone", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => makeVideo("video-1"));
      const ops = yield* ClipMockupOperationsService;
      const row = yield* createOne("video-1", "Keep me.", "a.png");

      const [updated] = yield* ops.updateClipMockups([
        { id: row.id, imagePath: "b.png" },
      ]);

      expect(updated!.imagePath).toBe("b.png");
      expect(updated!.line).toBe("Keep me.");
      expect(updated!.audioPath).toBe(row.audioPath);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("writes none of the edits when one of them is not found", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => makeVideo("video-1"));
      const ops = yield* ClipMockupOperationsService;
      const row = yield* createOne("video-1", "Untouched.", "a.png");

      const failure = yield* ops
        .updateClipMockups([
          { id: row.id, imagePath: "b.png" },
          { id: "nope", imagePath: "c.png" },
        ])
        .pipe(Effect.flip);

      expect(failure._tag).toBe("NotFoundError");
      const after = yield* ops.getClipMockupById(row.id);
      expect(after.imagePath).toBe("a.png");
    }).pipe(Effect.provide(testLayer))
  );
});
