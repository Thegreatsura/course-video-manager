import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Effect, Exit, Option } from "effect";
import { NodeContext } from "@effect/platform-node";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { computeExportHash, toExportClips } from "@/services/export-hash";
import { findExportedVideo } from "@/services/finished-videos.server";
import { listVideosForExportHash } from "@cvm/core/services/db-export-hash-videos.server";
import type { Database } from "@cvm/core/services/drizzle-service.server";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/test-db";
import type { StorageRoots } from "../index";
import { bucketCanBePurged, type StorageBucket } from "../client";
import { purgeExportedVideos } from "../purge";

/**
 * Purging a Storage Bucket's Exported Videos (#2111). Storage Roots are real
 * temp directories (`d`, `e`); "unplugging" E: is renaming it away. Nothing
 * outside `base` is ever touched.
 */

let testDb: TestDb;
let base: string;
let d: string;
let e: string;
let roots: StorageRoots;

const db = () => testDb as unknown as Database;

const put = (dir: string, relative: string, bytes = 10) => {
  const full = path.join(dir, relative);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, Buffer.alloc(bytes));
  return full;
};

const exists = (dir: string, relative: string) =>
  fs.existsSync(path.join(dir, relative));

/** Every file under `dir`, root-relative, symlinks listed as themselves. */
const tree = (dir: string): string[] => {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  const go = (sub: string) => {
    for (const entry of fs.readdirSync(path.join(dir, sub), {
      withFileTypes: true,
    })) {
      const rel = path.posix.join(sub, entry.name);
      if (entry.isDirectory()) go(rel);
      else out.push(rel);
    }
  };
  go("");
  return out.sort();
};

beforeAll(async () => {
  ({ testDb } = await createTestDb());
});

beforeEach(async () => {
  await truncateAllTables(testDb);
  base = fs.mkdtempSync(path.join(os.tmpdir(), "storage-purge-"));
  d = path.join(base, "d");
  e = path.join(base, "e");
  fs.mkdirSync(d);
  fs.mkdirSync(e);
  roots = [d, e];
});

afterEach(() => {
  for (const dir of [d, e, `${e}-unplugged`]) {
    const fv = path.join(dir, "finished-videos");
    if (fs.existsSync(fv)) fs.chmodSync(fv, 0o755);
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

const seedVideo = async (opts: {
  title: string;
  lessonId?: string;
  format?: "landscape" | "short";
  footage?: string[];
  session?: { camera: string; screen: string; mic: string };
}) => {
  const [video] = await testDb
    .insert(schema.videos)
    .values({
      title: opts.title,
      originalFootagePath: "",
      lessonId: opts.lessonId ?? null,
      format: opts.format ?? "landscape",
    })
    .returning();
  for (const stored of opts.footage ?? []) {
    await testDb.insert(schema.clips).values({
      videoId: video!.id,
      videoFilename: stored,
      sourceStartTime: 0,
      sourceEndTime: 1,
      order: `a${order++}`,
      text: "",
    });
  }
  if (opts.session) {
    const [session] = await testDb
      .insert(schema.recordingSessions)
      .values({
        videoId: video!.id,
        cameraFilePath: opts.session.camera,
        screenFilePath: opts.session.screen,
        micFilePath: opts.session.mic,
      })
      .returning();
    await testDb.insert(schema.clips).values({
      videoId: video!.id,
      videoFilename: opts.session.camera,
      recordingSessionId: session!.id,
      sourceStartTime: 0,
      sourceEndTime: 1,
      order: `a${order++}`,
      text: "",
    });
  }
  return video!.id;
};

/** The name of a Video's current Exported Video (hashed). */
const currentExport = async (videoId: string) => {
  const [video] = (await listVideosForExportHash(db())).filter(
    (v) => v.id === videoId
  );
  const hash = computeExportHash(
    toExportClips(video!.clips),
    video!.format,
    roots
  );
  return `finished-videos/${video!.courseId ?? video!.id}-${hash}.mp4`;
};

/** Whether the Video has an Exported Video on any root (else Unexported). */
const isExported = async (videoId: string) => {
  const name = path.posix.basename(await currentExport(videoId));
  const found = await Effect.runPromise(
    findExportedVideo(roots, name).pipe(Effect.provide(NodeContext.layer))
  );
  return Option.isSome(found);
};

const seedJob = (kind: string, status: "queued" | "running" | "succeeded") =>
  testDb.insert(schema.jobs).values({
    kind,
    title: `${kind}: Intro`,
    lane: "default",
    maxAttempts: 3,
    status,
  });

const run = (
  bucketId: string,
  more: {
    exportPaths?: string[];
    dryRun?: boolean;
    confineTo?: string;
  } = {}
) =>
  Effect.runPromiseExit(
    purgeExportedVideos({ db: db(), roots, bucketId, ...more })
  );

const ok = async (bucketId: string, more: Parameters<typeof run>[1] = {}) => {
  const exit = await run(bucketId, more);
  if (Exit.isFailure(exit)) throw new Error(String(exit.cause));
  return exit.value;
};

const refusalOf = (exit: Exit.Exit<unknown, unknown>) => {
  if (Exit.isSuccess(exit)) return null;
  const failure = exit.cause._tag === "Fail" ? exit.cause.error : exit.cause;
  return failure as { _tag: string; reason?: string; message: string };
};

/**
 * A Course with three Videos: `ready` (Footage on D:), `onE` (Footage only
 * on E:) and `missing` (one of its two takes is gone). Each has its current
 * Exported Video and digest.
 */
const seedCourseWithExports = async () => {
  const course = await seedCourse("Zod");
  const ready = await seedVideo({
    title: "Ready",
    lessonId: course.lessonId,
    footage: ["raw-footage/ready.mkv"],
  });
  const onE = await seedVideo({
    title: "On E",
    lessonId: course.lessonId,
    footage: ["raw-footage/on-e.mkv"],
  });
  const missing = await seedVideo({
    title: "Missing a take",
    lessonId: course.lessonId,
    footage: ["raw-footage/here.mkv", "raw-footage/gone.mkv"],
  });
  put(d, "raw-footage/ready.mkv", 100);
  put(d, "raw-footage/ready.mkv.transcript.json", 5);
  put(e, "raw-footage/on-e.mkv", 100);
  put(d, "raw-footage/here.mkv", 100);
  const exports = {
    ready: await currentExport(ready),
    onE: await currentExport(onE),
    missing: await currentExport(missing),
  };
  put(d, exports.ready, 300);
  put(d, `${exports.ready}.sha256`, 1);
  put(e, exports.onE, 200); // the export moved to E:
  put(e, `${exports.onE}.sha256`, 1);
  put(d, exports.missing, 400);
  put(d, `${exports.missing}.sha256`, 1);
  return { course, ready, onE, missing, exports };
};

describe("purgeExportedVideos", () => {
  it("deletes only eligible Videos' Exported Videos and companions, on whichever root holds them", async () => {
    const { course, ready, onE, missing, exports } =
      await seedCourseWithExports();
    const footageBefore = [
      ...tree(d).filter((f) => f.startsWith("raw-footage/")),
      ...tree(e).filter((f) => f.startsWith("raw-footage/")),
    ];

    const result = await ok(`course:${course.courseId}`);

    expect(exists(d, exports.ready)).toBe(false);
    expect(exists(d, `${exports.ready}.sha256`)).toBe(false);
    expect(exists(e, exports.onE)).toBe(false);
    expect(exists(e, `${exports.onE}.sha256`)).toBe(false);
    // Skipped: one of its takes is gone, so it could not be exported again.
    expect(exists(d, exports.missing)).toBe(true);
    expect(exists(d, `${exports.missing}.sha256`)).toBe(true);
    expect(result.videos).toBe(2);
    expect(result.deleted).toEqual([
      { location: d, files: 2, bytes: 301 },
      { location: e, files: 2, bytes: 201 },
    ]);
    expect(result.skipped).toEqual([
      {
        videoId: missing,
        title: "Missing a take",
        reason: "Footage not found on any Storage Root: raw-footage/gone.mkv",
        bytes: 401,
      },
    ]);
    expect(result.left).toEqual([]);

    // Footage and its transcript are exactly as they were.
    expect([
      ...tree(d).filter((f) => f.startsWith("raw-footage/")),
      ...tree(e).filter((f) => f.startsWith("raw-footage/")),
    ]).toEqual(footageBefore);

    // The purged Videos are Unexported Videos now; the skipped one is not.
    expect(await isExported(ready)).toBe(false);
    expect(await isExported(onE)).toBe(false);
    expect(await isExported(missing)).toBe(true);
  });

  it("skips a Video whose Footage is on an unplugged root, naming it", async () => {
    const { course, onE, exports } = await seedCourseWithExports();
    // The export of `onE` is on D: too; E: (with its Footage) is unplugged.
    put(d, exports.onE, 200);
    fs.renameSync(e, `${e}-unplugged`);

    const result = await ok(`course:${course.courseId}`);

    expect(exists(d, exports.onE)).toBe(true);
    const skipped = result.skipped.find((s) => s.videoId === onE);
    expect(skipped?.reason).toBe(
      `Footage not found (${e} offline?): raw-footage/on-e.mkv`
    );
  });

  it("a dry run deletes nothing and says what would go", async () => {
    const { course } = await seedCourseWithExports();
    const before = [...tree(d), ...tree(e)];

    const plan = await ok(`course:${course.courseId}`, { dryRun: true });

    expect([...tree(d), ...tree(e)]).toEqual(before);
    expect(plan.dryRun).toBe(true);
    expect(plan.videos).toBe(2);
    expect(plan.deleted.reduce((n, x) => n + x.bytes, 0)).toBe(502);
    expect(plan.skipped).toHaveLength(1);
  });

  it("keeps the Purge to the ticked Exported Videos", async () => {
    const { course, exports } = await seedCourseWithExports();

    const result = await ok(`course:${course.courseId}`, {
      exportPaths: [exports.onE, exports.missing],
    });

    expect(exists(d, exports.ready)).toBe(true);
    expect(exists(e, exports.onE)).toBe(false);
    expect(exists(e, `${exports.onE}.sha256`)).toBe(false);
    expect(exists(d, exports.missing)).toBe(true); // ticked, but skipped
    expect(result.videos).toBe(1);
    expect(result.skipped.map((s) => s.title)).toEqual(["Missing a take"]);
  });

  it("includes an uploaded Short: its hashed and flat exports go", async () => {
    const short = await seedVideo({
      title: "Short",
      format: "short",
      session: {
        camera: "raw-footage/s1/camera.mkv",
        screen: "raw-footage/s1/screen.mkv",
        mic: "raw-footage/s1/mic.wav",
      },
    });
    put(d, "raw-footage/s1/camera.mkv", 50);
    put(e, "raw-footage/s1/screen.mkv", 50);
    put(d, "raw-footage/s1/mic.wav", 5);
    const hashed = await currentExport(short);
    put(d, hashed, 70);
    put(d, `${hashed}.sha256`, 1);
    put(d, `finished-videos/${short}.mp4`, 80); // the vertical render

    const result = await ok("shorts");

    expect(tree(d).filter((f) => f.startsWith("finished-videos/"))).toEqual([]);
    expect(result.videos).toBe(1);
    expect(result.skipped).toEqual([]);
    expect(tree(d)).toEqual([
      "raw-footage/s1/camera.mkv",
      "raw-footage/s1/mic.wav",
    ]);
    expect(tree(e)).toEqual(["raw-footage/s1/screen.mkv"]);
    expect(await isExported(short)).toBe(false);
  });

  it("skips a CVM-recorder Video whose mic file is missing", async () => {
    const video = await seedVideo({
      title: "Session",
      session: {
        camera: "raw-footage/s2/camera.mkv",
        screen: "raw-footage/s2/screen.mkv",
        mic: "raw-footage/s2/mic.wav",
      },
    });
    put(d, "raw-footage/s2/camera.mkv", 50);
    put(d, "raw-footage/s2/screen.mkv", 50);
    const hashed = await currentExport(video);
    put(d, hashed, 70);

    const result = await ok("standalone-videos");

    expect(exists(d, hashed)).toBe(true);
    expect(result.skipped[0]?.reason).toBe(
      "Footage not found on any Storage Root: raw-footage/s2/mic.wav"
    );
  });

  it("skips a Video whose Footage is an empty file, or that has no Clips", async () => {
    const empty = await seedVideo({
      title: "Empty take",
      footage: ["raw-footage/empty.mkv"],
    });
    put(d, "raw-footage/empty.mkv", 0);
    const emptyExport = await currentExport(empty);
    put(d, emptyExport, 50);
    const noClips = await seedVideo({ title: "No clips" });
    put(d, `finished-videos/${noClips}.mp4`, 50);

    const result = await ok("standalone-videos");

    expect(exists(d, emptyExport)).toBe(true);
    expect(exists(d, `finished-videos/${noClips}.mp4`)).toBe(true);
    expect(result.videos).toBe(0);
    expect(result.skipped.map((s) => s.title).sort()).toEqual([
      "Empty take",
      "No clips",
    ]);
  });

  it("never deletes another bucket's exports, orphans, or anything outside finished-videos/", async () => {
    const { course, exports } = await seedCourseWithExports();
    const other = await seedCourse("Other");
    const otherVideo = await seedVideo({
      title: "Other",
      lessonId: other.lessonId,
      footage: ["raw-footage/ready.mkv"],
    });
    const otherExport = await currentExport(otherVideo);
    put(d, otherExport, 30);
    put(d, "finished-videos/stale-orphan.mp4", 30);
    put(d, "clip-mockups/v1/still.png");
    put(d, "overlay-renders/c1.mov");
    put(d, "video-files/lineage/thumb.png");

    await ok(`course:${course.courseId}`);

    expect(exists(d, exports.ready)).toBe(false);
    expect(exists(d, otherExport)).toBe(true);
    expect(exists(d, "finished-videos/stale-orphan.mp4")).toBe(true);
    expect(exists(d, "clip-mockups/v1/still.png")).toBe(true);
    expect(exists(d, "overlay-renders/c1.mov")).toBe(true);
    expect(exists(d, "video-files/lineage/thumb.png")).toBe(true);
  });

  it("refuses every bucket that is not a Course, Standalone Videos or Shorts", async () => {
    await seedCourseWithExports();
    const before = [...tree(d), ...tree(e)];
    for (const bucketId of [
      "shared-footage",
      "unused-footage",
      "clip-mockups",
      "overlay-render-cache",
      "export-scratch",
      "orphaned-exports",
      "course:does-not-exist",
      "raw-footage",
      "../raw-footage",
      "",
    ]) {
      const refusal = refusalOf(await run(bucketId));
      expect(refusal?.reason, bucketId).toBe("not-purgeable");
    }
    expect([...tree(d), ...tree(e)]).toEqual(before);
  });

  it("is refused while an export or a Publish is queued or running", async () => {
    const { course } = await seedCourseWithExports();
    const before = [...tree(d), ...tree(e)];
    await seedJob("publish", "queued");

    const refusal = refusalOf(await run(`course:${course.courseId}`));

    expect(refusal?.reason).toBe("export-running");
    expect([...tree(d), ...tree(e)]).toEqual(before);

    await truncateAllTables(testDb);
    const again = await seedCourseWithExports();
    await seedJob("render-vertical", "running");
    expect(
      refusalOf(await run(`course:${again.course.courseId}`))?.reason
    ).toBe("export-running");
  });

  it("a finished export or a transcribe Job doesn't block it", async () => {
    const { course, exports } = await seedCourseWithExports();
    await seedJob("export", "succeeded");
    await seedJob("transcribe", "running");

    await ok(`course:${course.courseId}`);

    expect(exists(d, exports.ready)).toBe(false);
  });

  it("a symlinked export pointing at Footage: the link and the take survive", async () => {
    const { course, exports } = await seedCourseWithExports();
    // The current export's name is a link to the raw take.
    fs.rmSync(path.join(d, exports.ready));
    fs.symlinkSync(
      path.join(d, "raw-footage/ready.mkv"),
      path.join(d, exports.ready)
    );

    const result = await ok(`course:${course.courseId}`);

    expect(fs.lstatSync(path.join(d, exports.ready)).isSymbolicLink()).toBe(
      true
    );
    expect(fs.statSync(path.join(d, "raw-footage/ready.mkv")).size).toBe(100);
    expect(result.left).toContainEqual({
      path: exports.ready,
      location: d,
      message: "Left: it is not a regular file (a link?)",
    });
  });

  it("finished-videos/ linked to raw-footage/: nothing in it is deleted", async () => {
    const { course } = await seedCourseWithExports();
    // E:'s whole finished-videos/ is a link to its raw-footage/.
    fs.rmSync(path.join(e, "finished-videos"), { recursive: true });
    const onE = await currentExport(
      (await listVideosForExportHash(db())).find((v) =>
        v.clips.some((c) => c.videoFilename === "raw-footage/on-e.mkv")
      )!.id
    );
    put(e, `raw-footage/${path.posix.basename(onE)}`, 200);
    fs.symlinkSync(
      path.join(e, "raw-footage"),
      path.join(e, "finished-videos")
    );

    const result = await ok(`course:${course.courseId}`);

    expect(exists(e, `raw-footage/${path.posix.basename(onE)}`)).toBe(true);
    expect(exists(e, "raw-footage/on-e.mkv")).toBe(true);
    expect(result.left.some((l) => l.location === e)).toBe(true);
  });

  it("a hard-linked take in finished-videos/ is checked by its real path: a regular file there goes, raw-footage is untouched", async () => {
    // A regular file in finished-videos/ is the export itself; the take in
    // raw-footage/ is a different directory entry and is never unlinked.
    const { course, exports } = await seedCourseWithExports();
    fs.rmSync(path.join(d, exports.ready));
    fs.linkSync(
      path.join(d, "raw-footage/ready.mkv"),
      path.join(d, exports.ready)
    );

    await ok(`course:${course.courseId}`);

    expect(exists(d, "raw-footage/ready.mkv")).toBe(true);
    expect(fs.statSync(path.join(d, "raw-footage/ready.mkv")).size).toBe(100);
  });

  it("confined to a verify run's own folder: roots outside it are left alone", async () => {
    const { course, exports } = await seedCourseWithExports();
    const runDir = path.join(base, "run");
    fs.mkdirSync(runDir);

    const result = await ok(`course:${course.courseId}`, { confineTo: runDir });

    expect(exists(d, exports.ready)).toBe(true);
    expect(exists(e, exports.onE)).toBe(true);
    expect(result.deleted).toEqual([]);
    expect(result.left.map((l) => l.location).sort()).toEqual([d, e].sort());
  });

  it("a file that can't be deleted is left and reported; the other root's still go", async () => {
    const { course, exports } = await seedCourseWithExports();
    fs.chmodSync(path.join(d, "finished-videos"), 0o555);

    const result = await ok(`course:${course.courseId}`);

    expect(exists(d, exports.ready)).toBe(true);
    expect(exists(e, exports.onE)).toBe(false);
    expect(result.left.map((l) => l.path).sort()).toEqual(
      [exports.ready, `${exports.ready}.sha256`].sort()
    );
  });
});

describe("bucketCanBePurged", () => {
  const bucket = (kind: StorageBucket["kind"], id: string = kind) =>
    ({ id, kind, name: id }) as StorageBucket;

  it("offers a Purge on a Course, Standalone Videos and Shorts only", () => {
    expect(bucketCanBePurged(bucket("course", "course:x"))).toBe(true);
    expect(bucketCanBePurged(bucket("standalone-videos"))).toBe(true);
    expect(bucketCanBePurged(bucket("shorts"))).toBe(true);
    for (const kind of [
      "shared-footage",
      "unused-footage",
      "clip-mockups",
      "overlay-render-cache",
      "export-scratch",
      "orphaned-exports",
    ] as const) {
      expect(bucketCanBePurged(bucket(kind)), kind).toBe(false);
    }
  });
});
