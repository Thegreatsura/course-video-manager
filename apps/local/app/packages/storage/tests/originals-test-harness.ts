import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Cause, Effect, Exit, Option } from "effect";
import { afterEach, beforeAll, beforeEach, expect } from "vitest";
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
import { runStorageMove } from "../move";
import {
  planStorageOriginals,
  runDeleteOriginals,
  type StorageOriginalsDisk,
} from "../originals";

/**
 * The shared fixture of the "Delete originals" tests (#2110): import it, and
 * its hooks set up each test. "Delete originals" (#2110): the one place raw Footage is deleted, and only
 * as a duplicate. Storage Roots are real temp directories (`d`, `e`) inside
 * `base`; nothing outside it is ever touched. The delete itself is the one
 * seam (a file Windows holds open).
 */

export let testDb: TestDb;
export let base: string;
export let d: string;
export let e: string;
export let roots: StorageRoots;

export const db = () => testDb as unknown as Database;

export const put = (
  dir: string,
  relative: string,
  content: string | Buffer
) => {
  const full = path.join(dir, relative);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
  return full;
};

export const read = (dir: string, relative: string) =>
  fs.readFileSync(path.join(dir, relative));

export const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

/** Every file (and link) under `dir`, relative to it. */
export const tree = (dir: string): string[] => {
  if (!fs.existsSync(dir)) return [];
  return (fs.readdirSync(dir, { recursive: true }) as string[])
    .filter((p) => !fs.lstatSync(path.join(dir, p)).isDirectory())
    .map((p) => p.split(path.sep).join("/"))
    .sort();
};

/** A file of `n` bytes that is not all one value. */
export const bytes = (n: number, seed = 1) =>
  Buffer.from(Array.from({ length: n }, (_, i) => (i * 31 + seed) % 251));

beforeAll(async () => {
  ({ testDb } = await createTestDb());
});

beforeEach(async () => {
  await truncateAllTables(testDb);
  base = fs.mkdtempSync(path.join(os.tmpdir(), "storage-originals-"));
  d = path.join(base, "d");
  e = path.join(base, "e");
  fs.mkdirSync(d);
  fs.mkdirSync(e);
  roots = [d, e];
});

afterEach(() => {
  // Undo any folder made read-only to play a locked file.
  for (const dir of [d, e]) {
    if (!fs.existsSync(dir)) continue;
    for (const p of fs.readdirSync(dir, { recursive: true }) as string[]) {
      const full = path.join(dir, p);
      const info = fs.lstatSync(full);
      if (info.isDirectory()) fs.chmodSync(full, 0o755);
    }
  }
  fs.rmSync(base, { recursive: true, force: true });
});

let order = 0;

export const seedCourse = async (name: string) => {
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

export const seedVideo = async (lessonId: string, footage: string[]) => {
  const [video] = await testDb
    .insert(schema.videos)
    .values({ title: `v${order++}`, originalFootagePath: "", lessonId })
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

export const exportNameOf = async (videoId: string) => {
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

/**
 * A Course with three takes, a transcript and an export on D:, Footage no
 * Clip uses (another bucket), and the Course's Footage and export moved to
 * E: by the real move.
 */
export const seedMovedCourse = async () => {
  const { courseId, lessonId } = await seedCourse("Crash Course");
  put(d, "raw-footage/take-1.mkv", bytes(5000, 1));
  put(d, "raw-footage/take-1.mkv.transcript.json", "{}");
  put(d, "raw-footage/sub/take-2.mkv", bytes(3000, 2));
  put(d, "raw-footage/unused.mkv", bytes(100, 3));
  const videoId = await seedVideo(lessonId, [
    // A legacy absolute path and a root-relative one: both this bucket's.
    path.join(d, "raw-footage/take-1.mkv"),
    "raw-footage/sub/take-2.mkv",
  ]);
  const exportName = await exportNameOf(videoId);
  put(d, `finished-videos/${exportName}`, bytes(4000, 4));
  put(d, `finished-videos/${exportName}.sha256`, "digest");
  const bucketId = courseBucketId(courseId);
  for (const kind of ["footage", "exported-videos"] as const) {
    const moved = await Effect.runPromiseExit(
      runStorageMove({
        db: db(),
        roots,
        bucketId,
        kind,
        target: e,
        cancelRequested: () => false,
      })
    );
    expect(Exit.isSuccess(moved)).toBe(true);
  }
  // Unused Footage was never moved: D: holds its only copy.
  expect(fs.existsSync(path.join(e, "raw-footage/unused.mkv"))).toBe(false);
  return { courseId, bucketId, videoId, exportName };
};

/** The confirmation (`dryRun`), or the `storage-delete` Job's own work. */
export const deleteOriginals = (opts: {
  bucketId: string;
  from?: string;
  dryRun?: boolean;
  disk?: StorageOriginalsDisk;
  confineTo?: string;
  roots?: StorageRoots;
  selfJobId?: string;
  cancelRequested?: () => boolean;
  onProgress?: (percent: number) => void;
}) => {
  const common = {
    db: db(),
    roots: opts.roots ?? roots,
    bucketId: opts.bucketId,
    from: opts.from ?? d,
    confineTo: opts.confineTo,
  };
  return Effect.runPromiseExit(
    opts.dryRun
      ? planStorageOriginals(common)
      : runDeleteOriginals({
          ...common,
          disk: opts.disk,
          selfJobId: opts.selfJobId,
          cancelRequested: opts.cancelRequested,
          onProgress: opts.onProgress,
        })
  );
};

export const valueOf = <A, E>(exit: Exit.Exit<A, E>) => {
  if (Exit.isFailure(exit)) {
    throw new Error(`expected success, got ${Cause.pretty(exit.cause)}`);
  }
  return exit.value;
};

export const failureOf = <A, E>(exit: Exit.Exit<A, E>) => {
  if (Exit.isSuccess(exit)) throw new Error("expected a failure");
  return Option.getOrThrow(Cause.failureOption(exit.cause)) as {
    _tag: string;
    reason?: string;
    message: string;
  };
};
