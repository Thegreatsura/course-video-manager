import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { Effect, Layer } from "effect";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/pglite";
import { ClipOperationsService } from "@/services/db-clip-operations.server";
import { DrizzleService } from "@/services/drizzle-service.server";
import {
  buildWriteLayer,
  makeRun,
  ndjson,
  one,
  seedWrite,
  type RunResult,
  type WriteSeed,
} from "./cli-write-test-harness";

// ===========================================================================
// cvm clip move --video: moving a Clip onto ANOTHER Video's timeline.
// (Split out of cli-clip-writes.test.ts, which holds the in-Video move.)
// Fixtures are seeded straight through ClipOperationsService, as there.
// ===========================================================================

let testDb: TestDb;
let seedLayer: Layer.Layer<ClipOperationsService>;
let run: (argv: ReadonlyArray<string>) => Promise<RunResult>;

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;
  seedLayer = ClipOperationsService.Default.pipe(
    Layer.provide(Layer.succeed(DrizzleService, testDb as never))
  );
  run = makeRun(buildWriteLayer(testDb));
});

let s: WriteSeed;
beforeEach(async () => {
  await truncateAllTables(testDb);
  s = await seedWrite(testDb);
});

interface ClipRow {
  id: string;
  videoId: string;
  order: string;
  scene: string | null;
  text: string;
}

const list = async (videoId: string): Promise<ClipRow[]> =>
  ndjson((await run(["clip", "list", "--video", videoId])).stdout) as ClipRow[];

/** Seed a clip; `after` appends it behind that clip instead of at the start. */
const seedClip = (
  videoId: string,
  opts: { start: number; end: number; scene?: string; after?: string }
): Promise<ClipRow> =>
  Effect.gen(function* () {
    const clipOps = yield* ClipOperationsService;
    const [clip] = yield* clipOps.appendClips({
      videoId,
      insertionPoint:
        opts.after === undefined
          ? { type: "start" }
          : { type: "after-clip", databaseClipId: opts.after },
      clips: [
        { inputVideo: "test.mp4", startTime: opts.start, endTime: opts.end },
      ],
    });
    if (opts.scene !== undefined) {
      return (yield* clipOps.updateClip(clip!.id, {
        scene: opts.scene,
      })) as unknown as ClipRow;
    }
    return clip as unknown as ClipRow;
  }).pipe(Effect.provide(seedLayer), Effect.runPromise);

describe("clip move --video (cross-video)", () => {
  it("with no anchor appends to the END of the target, keeping scene/text", async () => {
    const a = await seedClip(s.standaloneActiveId, {
      start: 0,
      end: 1,
      scene: "Code",
    });
    const b = await seedClip(s.standaloneActiveId, {
      start: 1,
      end: 2,
      after: a.id,
    });
    const t = await seedClip(s.lessonVideoId, { start: 0, end: 1 });

    const moved = one<ClipRow>(
      (await run(["clip", "move", "--video", s.lessonVideoId, a.id])).stdout
    );

    // Only videoId and order change — the row is the same clip, not a copy.
    const { videoId: _v, order: _o, ...kept } = moved;
    const {
      videoId: _v0,
      order: _o0,
      ...original
    } = JSON.parse(JSON.stringify(a)) as ClipRow;
    expect(moved.videoId).toBe(s.lessonVideoId);
    expect(kept).toEqual(original);
    expect((await list(s.lessonVideoId)).map((r) => r.id)).toEqual([
      t.id,
      a.id,
    ]);
    expect((await list(s.standaloneActiveId)).map((r) => r.id)).toEqual([b.id]);
  });

  it("--before / --after resolve against the TARGET timeline", async () => {
    const a = await seedClip(s.standaloneActiveId, { start: 0, end: 1 });
    const b = await seedClip(s.standaloneActiveId, {
      start: 1,
      end: 2,
      after: a.id,
    });
    const t1 = await seedClip(s.lessonVideoId, { start: 0, end: 1 });
    const t2 = await seedClip(s.lessonVideoId, {
      start: 1,
      end: 2,
      after: t1.id,
    });

    await run([
      "clip",
      "move",
      "--video",
      s.lessonVideoId,
      "--before",
      t2.id,
      a.id,
    ]);
    await run([
      "clip",
      "move",
      "--video",
      s.lessonVideoId,
      "--after",
      t1.id,
      b.id,
    ]);

    expect((await list(s.lessonVideoId)).map((r) => r.id)).toEqual([
      t1.id,
      b.id,
      a.id,
      t2.id,
    ]);
  });

  it("an anchor on the SOURCE video => NotFoundError, exit 2, nothing moves", async () => {
    const a = await seedClip(s.standaloneActiveId, { start: 0, end: 1 });
    const b = await seedClip(s.standaloneActiveId, {
      start: 1,
      end: 2,
      after: a.id,
    });
    const { exitCode } = await run([
      "clip",
      "move",
      "--video",
      s.lessonVideoId,
      "--before",
      b.id,
      a.id,
    ]);
    expect(exitCode).toBe(2);
    expect((await list(s.standaloneActiveId)).map((r) => r.id)).toEqual([
      a.id,
      b.id,
    ]);
  });

  it("an unknown target video => NotFoundError on video, exit 2", async () => {
    const a = await seedClip(s.standaloneActiveId, { start: 0, end: 1 });
    const { stdout, stderr, exitCode } = await run([
      "clip",
      "move",
      "--video",
      "vid_missing",
      a.id,
    ]);
    expect(exitCode).toBe(2);
    expect(stdout).toBe("");
    expect((JSON.parse(stderr.trim()) as { entity: string }).entity).toBe(
      "video"
    );
  });

  it("--video naming the clip's own video still needs an anchor, exit 3", async () => {
    const a = await seedClip(s.standaloneActiveId, { start: 0, end: 1 });
    const { exitCode } = await run([
      "clip",
      "move",
      "--video",
      s.standaloneActiveId,
      a.id,
    ]);
    expect(exitCode).toBe(3);
  });
});
