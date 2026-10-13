import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Cause, Effect, Exit, Option } from "effect";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { computeExportHash, toExportClips } from "@/services/export-hash";
import { listVideosForExportHash } from "@cvm/core/services/db-export-hash-videos.server";
import type { Database } from "@cvm/core/services/drizzle-service.server";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/pglite";
import { courseBucketId } from "../buckets";
import type { StorageRoots } from "../index";
import {
  MOVE_PARTIAL_SUFFIX,
  planStorageMove,
  realStorageMoveDisk,
  runStorageMove,
  type StorageMoveDisk,
} from "../move";

/**
 * Moving a Storage Bucket between drives (#2109). Storage Roots are real temp
 * directories (`d`, `e`); nothing outside `base` is ever touched. The disk's
 * free space and its writes are the one seam: a full or a bad drive.
 */

let testDb: TestDb;
let base: string;
let d: string;
let e: string;
let roots: StorageRoots;

const db = () => testDb as unknown as Database;

const put = (dir: string, relative: string, content: string | Buffer) => {
  const full = path.join(dir, relative);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
  return full;
};

const read = (dir: string, relative: string) =>
  fs.readFileSync(path.join(dir, relative));

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

/** Every file under `dir`, relative to it. */
const tree = (dir: string): string[] => {
  if (!fs.existsSync(dir)) return [];
  return (fs.readdirSync(dir, { recursive: true }) as string[])
    .filter((p) => fs.lstatSync(path.join(dir, p)).isFile())
    .map((p) => p.split(path.sep).join("/"))
    .sort();
};

/** A file of `n` bytes that is not all one value. */
const bytes = (n: number, seed = 1) =>
  Buffer.from(Array.from({ length: n }, (_, i) => (i * 31 + seed) % 251));

beforeAll(async () => {
  ({ testDb } = await createTestDb());
});

beforeEach(async () => {
  await truncateAllTables(testDb);
  base = fs.mkdtempSync(path.join(os.tmpdir(), "storage-move-"));
  d = path.join(base, "d");
  e = path.join(base, "e");
  fs.mkdirSync(d);
  fs.mkdirSync(e);
  roots = [d, e];
});

afterEach(() => {
  for (const dir of [d, e]) {
    for (const f of ["raw-footage", "finished-videos"]) {
      const at = path.join(dir, f);
      if (fs.existsSync(at) && !fs.lstatSync(at).isSymbolicLink()) {
        fs.chmodSync(at, 0o755);
      }
    }
  }
  fs.rmSync(base, { recursive: true, force: true });
});

let order = 0;

const seedCourse = async (name: string) => {
  const [course] = await testDb
    .insert(schema.courses)
    .values({ name })
    .returning();
  const [version] = await testDb
    .insert(schema.courseVersions)
    .values({ repoId: course!.id, name: "v1" })
    .returning();
  const [section] = await testDb
    .insert(schema.sections)
    .values({ repoVersionId: version!.id, order: 1 })
    .returning();
  const [lesson] = await testDb
    .insert(schema.lessons)
    .values({ sectionId: section!.id, order: 1 })
    .returning();
  return { courseId: course!.id, lessonId: lesson!.id };
};

const seedVideo = async (lessonId: string, footage: string[]) => {
  const [video] = await testDb
    .insert(schema.videos)
    .values({ title: "v", originalFootagePath: "", lessonId })
    .returning();
  for (const stored of footage) {
    await testDb.insert(schema.clips).values({
      videoId: video!.id,
      videoFilename: stored,
      sourceStartTime: 0,
      sourceEndTime: 1,
      order: `a${order++}`,
      text: "",
    });
  }
  return video!.id;
};

const exportNameOf = async (videoId: string) => {
  const video = (await listVideosForExportHash(db())).find(
    (v) => v.id === videoId
  )!;
  const hash = computeExportHash(
    toExportClips(video.clips),
    video.format,
    roots
  );
  return `${video.courseId}-${hash}.mp4`;
};

/** A Course with two takes, a transcript beside one, and an export. */
const seedCourseWithFootage = async () => {
  const { courseId, lessonId } = await seedCourse("Crash Course");
  put(d, "raw-footage/take-1.mkv", bytes(5000, 1));
  put(d, "raw-footage/take-1.mkv.transcript.json", "{}");
  put(d, "raw-footage/sub/take-2.mkv", bytes(3000, 2));
  // Someone else's: never moved with this bucket.
  put(d, "raw-footage/unused.mkv", bytes(100, 3));
  const videoId = await seedVideo(lessonId, [
    // A legacy absolute path and a root-relative one: both are this bucket's.
    path.join(d, "raw-footage/take-1.mkv"),
    "raw-footage/sub/take-2.mkv",
  ]);
  const exportName = await exportNameOf(videoId);
  put(d, `finished-videos/${exportName}`, bytes(4000, 4));
  put(d, `finished-videos/${exportName}.sha256`, "digest");
  return { courseId, bucketId: courseBucketId(courseId), videoId, exportName };
};

const disk = (overrides: Partial<StorageMoveDisk> = {}): StorageMoveDisk => ({
  ...realStorageMoveDisk,
  ...overrides,
});

const move = (opts: {
  bucketId: string;
  kind?: "footage" | "exported-videos" | "clip-mockups";
  target?: string;
  cancelRequested?: () => boolean;
  disk?: StorageMoveDisk;
}) =>
  Effect.runPromiseExit(
    runStorageMove({
      db: db(),
      roots,
      bucketId: opts.bucketId,
      kind: opts.kind ?? "footage",
      target: opts.target ?? e,
      cancelRequested: opts.cancelRequested ?? (() => false),
      disk: opts.disk,
    })
  );

const plan = (opts: {
  bucketId: string;
  kind?: "footage" | "exported-videos" | "clip-mockups";
  target?: string;
  disk?: StorageMoveDisk;
}) =>
  Effect.runPromise(
    planStorageMove({
      db: db(),
      roots,
      bucketId: opts.bucketId,
      kind: opts.kind ?? "footage",
      target: opts.target ?? e,
      disk: opts.disk,
    })
  );

const failureOf = <A, E>(exit: Exit.Exit<A, E>) => {
  if (Exit.isSuccess(exit)) throw new Error("expected a failure");
  return Option.getOrThrow(Cause.failureOption(exit.cause)) as {
    _tag: string;
    message: string;
    refusals?: { reason: string }[];
  };
};

describe("planStorageMove", () => {
  it("counts what would be copied and the target's free space", async () => {
    const { bucketId } = await seedCourseWithFootage();
    const p = await plan({ bucketId });
    expect(p.files).toBe(3);
    expect(p.filesToCopy).toBe(3);
    expect(p.bytesToCopy).toBe(5000 + 2 + 3000);
    expect(p.freeBytes).toBeGreaterThan(0);
    expect(p.targetLabel).toBe(e);
    expect(p.refusals).toEqual([]);
  });

  it("refuses when the target has no room, before anything is written", async () => {
    const { bucketId } = await seedCourseWithFootage();
    const small = disk({ freeBytes: async () => 1000 });
    expect((await plan({ bucketId, disk: small })).refusals).toEqual([
      expect.objectContaining({ reason: "no-room" }),
    ]);
    const exit = await move({ bucketId, disk: small });
    expect(failureOf(exit).refusals).toEqual([
      expect.objectContaining({ reason: "no-room" }),
    ]);
    expect(tree(e)).toEqual([]);
  });
});

describe("runStorageMove", () => {
  it("copies and verifies a bucket's Footage with its companions, and keeps every original and row", async () => {
    const { bucketId, videoId } = await seedCourseWithFootage();
    const before = tree(d);
    const rowsBefore = await testDb.select().from(schema.clips);
    const hashBefore = await exportNameOf(videoId);

    const exit = await move({ bucketId });
    expect(Exit.isSuccess(exit)).toBe(true);
    const result = Exit.isSuccess(exit) ? exit.value : null;
    expect(result?.copied).toEqual({ files: 3, bytes: 8002 });
    expect(result?.left).toEqual([]);

    expect(tree(e)).toEqual([
      "raw-footage/sub/take-2.mkv",
      "raw-footage/take-1.mkv",
      "raw-footage/take-1.mkv.transcript.json",
    ]);
    for (const f of tree(e)) {
      expect(sha(read(e, f))).toBe(sha(read(d, f)));
    }
    // Originals untouched; no row and no Export Hash changed.
    expect(tree(d)).toEqual(before);
    expect(await testDb.select().from(schema.clips)).toEqual(rowsBefore);
    expect(await exportNameOf(videoId)).toBe(hashBefore);
  });

  it("moves Exported Videos with their companions", async () => {
    const { bucketId, exportName } = await seedCourseWithFootage();
    const exit = await move({ bucketId, kind: "exported-videos" });
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(tree(e)).toEqual([
      `finished-videos/${exportName}`,
      `finished-videos/${exportName}.sha256`,
    ]);
    expect(fs.existsSync(path.join(d, "finished-videos", exportName))).toBe(
      true
    );
  });

  it("resumes a lost run's partial copy by size, and checks a copy it had already placed", async () => {
    const { bucketId } = await seedCourseWithFootage();
    // The lost run placed take-2 (verified) and was half way through take-1.
    put(e, "raw-footage/sub/take-2.mkv", read(d, "raw-footage/sub/take-2.mkv"));
    const placedAt = fs.statSync(path.join(e, "raw-footage/sub/take-2.mkv"));
    put(
      e,
      `raw-footage/take-1.mkv${MOVE_PARTIAL_SUFFIX}`,
      read(d, "raw-footage/take-1.mkv").subarray(0, 2000)
    );
    const written: { position: number; length: number }[] = [];
    const exit = await move({
      bucketId,
      disk: disk({
        write: (file, buffer, length, position) => {
          written.push({ position, length });
          return realStorageMoveDisk.write(file, buffer, length, position);
        },
      }),
    });
    expect(Exit.isSuccess(exit)).toBe(true);
    const result = Exit.isSuccess(exit) ? exit.value : null;
    expect(result?.verified).toEqual({ files: 1, bytes: 3000 });
    expect(result?.copied.files).toBe(2);
    // take-1 was resumed at the partial's size, not started again.
    expect(written).toContainEqual({ position: 2000, length: 3000 });
    // Nothing but the rest of take-1 and the 2-byte transcript was written.
    expect(written.reduce((n, w) => n + w.length, 0)).toBe(3000 + 2);
    expect(sha(read(e, "raw-footage/take-1.mkv"))).toBe(
      sha(read(d, "raw-footage/take-1.mkv"))
    );
    // The copy already placed was checked, never rewritten.
    expect(
      fs.statSync(path.join(e, "raw-footage/sub/take-2.mkv")).mtimeMs
    ).toBe(placedAt.mtimeMs);
    expect(tree(e).some((f) => f.endsWith(MOVE_PARTIAL_SUFFIX))).toBe(false);
  });

  it("cancelled mid-copy, removes its partials and leaves every original", async () => {
    const { bucketId } = await seedCourseWithFootage();
    const before = tree(d).map((f) => [f, sha(read(d, f))]);
    let writes = 0;
    const exit = await move({
      bucketId,
      // Cancel once the first chunk of the first file has been written.
      cancelRequested: () => writes > 0,
      disk: disk({
        write: (file, buffer, length, position) => {
          writes++;
          return realStorageMoveDisk.write(file, buffer, length, position);
        },
      }),
    });
    expect(failureOf(exit)._tag).toBe("StorageMoveCancelledError");
    expect(tree(e)).toEqual([]);
    expect(tree(d).map((f) => [f, sha(read(d, f))])).toEqual(before);
  });

  it("a checksum mismatch (a bad drive) leaves no copy at the real name, and the original", async () => {
    const { bucketId } = await seedCourseWithFootage();
    const original = read(d, "raw-footage/take-1.mkv");
    const exit = await move({
      bucketId,
      disk: disk({
        // E: flips a bit in every write.
        write: (file, buffer, length, position) => {
          const bad = Buffer.from(buffer.subarray(0, length));
          bad[0] = bad[0]! ^ 1;
          return realStorageMoveDisk.write(file, bad, length, position);
        },
      }),
    });
    expect(Exit.isSuccess(exit)).toBe(true);
    const result = Exit.isSuccess(exit) ? exit.value : null;
    expect(result?.copied.files).toBe(0);
    expect(result?.left).toHaveLength(3);
    expect(result?.left[0]?.message).toMatch(/checksum mismatch/);
    expect(tree(e)).toEqual([]);
    expect(read(d, "raw-footage/take-1.mkv").equals(original)).toBe(true);
  });

  it("a destination that fills up mid-move stops, removes the partial, and keeps what was verified", async () => {
    const { bucketId } = await seedCourseWithFootage();
    let free = 3500; // room for take-2 (3000) and the transcript, not take-1
    const exit = await move({
      bucketId,
      disk: disk({
        freeBytes: async () => free,
        write: async (file, buffer, length, position) => {
          free -= length;
          return realStorageMoveDisk.write(file, buffer, length, position);
        },
      }),
    });
    // The plan saw 3500 free and 8002 to copy: refused before starting.
    expect(failureOf(exit).refusals?.[0]?.reason).toBe("no-room");

    // Room for the whole plan, then the drive fills while copying.
    free = 100_000;
    let calls = 0;
    const filling = await move({
      bucketId,
      disk: disk({
        freeBytes: async () => (calls++ === 0 ? 100_000 : 10),
      }),
    });
    expect(failureOf(filling)._tag).toBe("StorageMoveFailedError");
    expect(failureOf(filling).message).toMatch(/full/);
    expect(tree(e).some((f) => f.endsWith(MOVE_PARTIAL_SUFFIX))).toBe(false);
    expect(tree(d)).toContain("raw-footage/take-1.mkv");
  });

  it("an ENOSPC while writing is a full drive: the partial goes, originals stay", async () => {
    const { bucketId } = await seedCourseWithFootage();
    const exit = await move({
      bucketId,
      disk: disk({
        write: async () => {
          throw Object.assign(new Error("no space left on device"), {
            code: "ENOSPC",
          });
        },
      }),
    });
    expect(failureOf(exit).message).toMatch(/full/);
    expect(tree(e)).toEqual([]);
    expect(tree(d)).toContain("raw-footage/take-1.mkv");
  });

  it("never overwrites a different file already at the destination", async () => {
    const { bucketId } = await seedCourseWithFootage();
    put(e, "raw-footage/take-1.mkv", "someone else's file");
    const exit = await move({ bucketId });
    const result = Exit.isSuccess(exit) ? exit.value : null;
    expect(result?.left).toEqual([
      {
        path: "raw-footage/take-1.mkv",
        message: expect.stringMatching(/never overwritten/),
      },
    ]);
    expect(read(e, "raw-footage/take-1.mkv").toString()).toBe(
      "someone else's file"
    );
    expect(result?.copied.files).toBe(2);
  });

  it("refuses a target whose folder is a symlink out of the root, writing nothing through it", async () => {
    const { bucketId } = await seedCourseWithFootage();
    const outside = path.join(base, "outside");
    fs.mkdirSync(outside);
    fs.symlinkSync(outside, path.join(e, "raw-footage"));
    const exit = await move({ bucketId });
    expect(failureOf(exit).refusals).toEqual([
      expect.objectContaining({ reason: "unsafe-folder" }),
    ]);
    expect(fs.readdirSync(outside)).toEqual([]);
  });

  it("never follows a symlinked source file", async () => {
    await seedCourseWithFootage();
    const secret = put(base, "secret.mkv", "not Footage");
    fs.symlinkSync(secret, path.join(d, "raw-footage/link.mkv"));
    const exit = await move({ bucketId: "unused-footage" });
    const result = Exit.isSuccess(exit) ? exit.value : null;
    expect(result?.left).toEqual([
      { path: "raw-footage/link.mkv", message: expect.stringMatching(/link/) },
    ]);
    expect(tree(e)).toEqual(["raw-footage/unused.mkv"]);
  });

  it("refuses an Offline target, and a bucket that can't be moved", async () => {
    const { bucketId } = await seedCourseWithFootage();
    fs.rmSync(e, { recursive: true });
    expect((await plan({ bucketId })).refusals.map((r) => r.reason)).toContain(
      "target-offline"
    );
    expect(
      (await plan({ bucketId: "overlay-render-cache" })).refusals.map(
        (r) => r.reason
      )
    ).toEqual(["not-movable"]);
    expect(
      (await plan({ bucketId, target: path.join(base, "f") })).refusals.map(
        (r) => r.reason
      )
    ).toEqual(["unknown-target"]);
  });

  it("refuses while an export runs for a Video in the bucket, or a recording is active", async () => {
    const { bucketId, videoId } = await seedCourseWithFootage();
    await testDb.insert(schema.jobs).values({
      kind: "export",
      title: "Export: v",
      lane: "default",
      params: { videoId },
      status: "running",
      maxAttempts: 3,
    });
    await testDb.insert(schema.recordingSessions).values({
      videoId,
      cameraFilePath: "raw-footage/s/camera.mkv",
      screenFilePath: "raw-footage/s/screen.mkv",
      micFilePath: "raw-footage/s/mic.wav",
      status: "recording",
    });
    const exit = await move({ bucketId });
    expect(failureOf(exit).refusals?.map((r) => r.reason)).toEqual([
      "export-running",
      "recording-active",
    ]);
    expect(tree(e)).toEqual([]);
  });

  it("moves back to the first root just the same", async () => {
    await seedCourseWithFootage();
    // Footage that is only on E: comes back to D:.
    put(e, "raw-footage/sub/take-3.mkv", bytes(10, 9));
    const exit = await move({ bucketId: "unused-footage", target: d });
    const result = Exit.isSuccess(exit) ? exit.value : null;
    expect(result?.copied.files).toBe(1);
    expect(sha(read(d, "raw-footage/sub/take-3.mkv"))).toBe(sha(bytes(10, 9)));
    // The Course's own Footage, only on D:, is not part of that bucket.
    expect(tree(e)).not.toContain("raw-footage/take-1.mkv");
  });
});
