import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Effect, Exit } from "effect";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { EXPORT_HASH_RENAME_MARKER } from "@/services/export-hash-rename";
import { computeExportHash, toExportClips } from "@/services/export-hash";
import { listVideosForExportHash } from "@cvm/core/services/db-export-hash-videos.server";
import type { Database } from "@cvm/core/services/drizzle-service.server";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/pglite";
import type { StorageRoots } from "../index";
import { bucketCanBeDeleted, type StorageBucket } from "../client";
import { deleteOtherStorageBucket } from "../delete";

/**
 * Deleting an Other Storage Bucket (#2112). Storage Roots are real temp
 * directories (`d`, `e`) and export scratch another; nothing outside `base`
 * is ever touched.
 */

let testDb: TestDb;
let base: string;
let d: string;
let e: string;
let scratch: string;
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

const markRenameDone = () =>
  put(d, `finished-videos/${EXPORT_HASH_RENAME_MARKER}`, 2);

beforeAll(async () => {
  ({ testDb } = await createTestDb());
});

beforeEach(async () => {
  await truncateAllTables(testDb);
  base = fs.mkdtempSync(path.join(os.tmpdir(), "storage-delete-other-"));
  d = path.join(base, "d");
  e = path.join(base, "e");
  scratch = path.join(base, "scratch");
  fs.mkdirSync(d);
  fs.mkdirSync(e);
  roots = [d, e];
});

afterEach(() => {
  // Undo any read-only folder a test made, so the temp dir can go.
  for (const dir of [d, e]) {
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
  lessonId?: string;
  format?: "landscape" | "short";
  footage: string[];
}) => {
  const [video] = await testDb
    .insert(schema.videos)
    .values({
      title: "v",
      originalFootagePath: "",
      lessonId: opts.lessonId ?? null,
      format: opts.format ?? "landscape",
    })
    .returning();
  for (const stored of opts.footage) {
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

/** The name of a Video's current Exported Video. */
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

const seedJob = (kind: string, status: "queued" | "running" | "succeeded") =>
  testDb.insert(schema.jobs).values({
    kind,
    title: `${kind}: Intro`,
    lane: "default",
    maxAttempts: 3,
    status,
  });

const run = (bucketId: string, scratchDir = scratch, confineTo?: string) =>
  Effect.runPromiseExit(
    deleteOtherStorageBucket({
      db: db(),
      roots,
      bucketId,
      scratchDir,
      ...(confineTo === undefined ? {} : { confineTo }),
    })
  );

const refusalOf = (exit: Exit.Exit<unknown, unknown>) => {
  if (Exit.isSuccess(exit)) return null;
  const failure = exit.cause._tag === "Fail" ? exit.cause.error : exit.cause;
  return failure as { _tag: string; reason?: string; message: string };
};

/** Everything a Storage Bucket other than the one deleted holds. */
const seedEverythingElse = () => {
  put(d, "raw-footage/a.mkv", 100);
  put(e, "raw-footage/a.mkv", 100);
  put(d, "raw-footage/a.mkv.transcript.json");
  put(d, "raw-footage/session/camera.mkv");
  put(d, "raw-footage/unused.mkv");
  put(d, "clip-mockups/v1/still.png");
  put(e, "clip-mockups/v2/still.png");
  put(d, "video-files/lineage/thumb.png");
};

describe("deleteOtherStorageBucket", () => {
  it("deletes only the files named, and a dry run deletes nothing", async () => {
    put(d, "overlay-renders/a.mov", 40);
    put(d, "overlay-renders/b.mov", 20);
    put(e, "overlay-renders/a.mov", 30);
    // Named, but not this bucket's: never deleted.
    put(d, "raw-footage/x.mkv");

    const files = [
      { location: d, path: "overlay-renders/a.mov" },
      { location: d, path: "raw-footage/x.mkv" },
    ];
    const dry = await Effect.runPromise(
      deleteOtherStorageBucket({
        db: db(),
        roots,
        bucketId: "overlay-render-cache",
        scratchDir: scratch,
        files,
        dryRun: true,
      })
    );
    expect(dry.deleted).toEqual([{ location: d, files: 1, bytes: 40 }]);
    expect(exists(d, "overlay-renders/a.mov")).toBe(true);

    await Effect.runPromise(
      deleteOtherStorageBucket({
        db: db(),
        roots,
        bucketId: "overlay-render-cache",
        scratchDir: scratch,
        files,
      })
    );
    expect(exists(d, "overlay-renders/a.mov")).toBe(false);
    expect(exists(d, "overlay-renders/b.mov")).toBe(true);
    expect(exists(e, "overlay-renders/a.mov")).toBe(true);
    expect(exists(d, "raw-footage/x.mkv")).toBe(true);
  });

  it("deletes the Overlay Render Cache on every root, and nothing else", async () => {
    seedEverythingElse();
    put(d, "overlay-renders/c1-abc.mov", 40);
    put(d, "overlay-renders/nested/c1-def.mov", 20);
    put(e, "overlay-renders/c2-ghi.mov", 30);
    put(scratch, "pass-1.mp4");
    markRenameDone();
    put(d, "finished-videos/stale-x.mp4");

    const exit = await run("overlay-render-cache");

    expect(exit).toEqual(
      Exit.succeed({
        bucketId: "overlay-render-cache",
        deleted: [
          { location: d, files: 2, bytes: 60 },
          { location: e, files: 1, bytes: 30 },
        ],
        left: [],
      })
    );
    // The folders stay (renders go back in them); emptied subfolders go.
    expect(tree(path.join(d, "overlay-renders"))).toEqual([]);
    expect(fs.readdirSync(path.join(d, "overlay-renders"))).toEqual([]);
    expect(tree(path.join(e, "overlay-renders"))).toEqual([]);
    expect(tree(d)).toEqual(
      [
        `finished-videos/${EXPORT_HASH_RENAME_MARKER}`,
        "clip-mockups/v1/still.png",
        "finished-videos/stale-x.mp4",
        "raw-footage/a.mkv",
        "raw-footage/a.mkv.transcript.json",
        "raw-footage/session/camera.mkv",
        "raw-footage/unused.mkv",
        "video-files/lineage/thumb.png",
      ].sort()
    );
    expect(tree(e)).toEqual(["clip-mockups/v2/still.png", "raw-footage/a.mkv"]);
    expect(tree(scratch)).toEqual(["pass-1.mp4"]);
  });

  it("deletes export scratch, and nothing on any root", async () => {
    seedEverythingElse();
    put(d, "overlay-renders/c1-abc.mov");
    put(scratch, "pass-1.mp4", 7);
    put(scratch, "job-1/segment-2.mp4", 8);

    const exit = await run("export-scratch");

    expect(exit).toEqual(
      Exit.succeed({
        bucketId: "export-scratch",
        deleted: [{ location: scratch, files: 2, bytes: 15 }],
        left: [],
      })
    );
    expect(fs.readdirSync(scratch)).toEqual([]);
    expect(exists(d, "overlay-renders/c1-abc.mov")).toBe(true);
    expect(exists(d, "raw-footage/a.mkv")).toBe(true);
  });

  it("refuses export scratch, deleting nothing, while an export is running or queued", async () => {
    put(scratch, "pass-1.mp4");
    await seedJob("export", "running");

    const running = refusalOf(await run("export-scratch"));
    expect(running).toMatchObject({
      _tag: "StorageDeleteRefusedError",
      reason: "export-running",
    });
    expect(running!.message).toContain("export: Intro");
    expect(tree(scratch)).toEqual(["pass-1.mp4"]);

    await truncateAllTables(testDb);
    await seedJob("publish", "queued");
    expect(refusalOf(await run("export-scratch"))).toMatchObject({
      reason: "export-running",
    });
    expect(tree(scratch)).toEqual(["pass-1.mp4"]);

    // A finished export, or a Job that encodes nothing, does not block it.
    await truncateAllTables(testDb);
    await seedJob("export", "succeeded");
    await seedJob("transcribe-clips", "running");
    expect(Exit.isSuccess(await run("export-scratch"))).toBe(true);
    expect(tree(scratch)).toEqual([]);
  });

  it("deletes Exported Videos of no current Video, never a current one (Course, Standalone, Short)", async () => {
    seedEverythingElse();
    const course = await seedCourse("Course A");
    const courseVideo = await seedVideo({
      lessonId: course.lessonId,
      footage: ["raw-footage/a.mkv"],
    });
    const standalone = await seedVideo({ footage: ["raw-footage/b.mkv"] });
    const short = await seedVideo({
      format: "short",
      footage: ["raw-footage/c.mkv"],
    });
    const courseExport = await currentExport(courseVideo);
    const standaloneExport = await currentExport(standalone);
    const shortExport = await currentExport(short);
    markRenameDone();

    // Current: every one stays, wherever it is.
    put(d, courseExport);
    put(d, `${courseExport}.sha256`);
    put(e, standaloneExport); // moved to E:
    put(d, shortExport);
    put(d, `finished-videos/${short}.mp4`); // the Short's vertical render
    put(d, `finished-videos/${standalone}.mp4`); // a live Video's flat name
    // Orphaned: a stale Course export, #1493's standalone orphan, a legacy
    // flat file of a Video since deleted.
    put(d, `finished-videos/${course.courseId}-stalehash.mp4`, 50);
    put(d, `finished-videos/${course.courseId}-stalehash.mp4.sha256`, 1);
    put(e, `finished-videos/${standalone}-stalehash.mp4`, 40);
    put(d, "finished-videos/deleted-video-id.mp4", 9);
    put(d, "finished-videos/notes.txt", 3); // not an export: left, reported

    const exit = await run("orphaned-exports");

    expect(exit).toEqual(
      Exit.succeed({
        bucketId: "orphaned-exports",
        deleted: [
          { location: d, files: 3, bytes: 60 },
          { location: e, files: 1, bytes: 40 },
        ],
        left: [
          {
            path: "finished-videos/notes.txt",
            location: d,
            message: "Left: it is not an Exported Video or its companion",
          },
        ],
      })
    );
    expect(tree(path.join(d, "finished-videos"))).toEqual(
      [
        "notes.txt",
        EXPORT_HASH_RENAME_MARKER,
        path.basename(courseExport),
        `${path.basename(courseExport)}.sha256`,
        path.basename(shortExport),
        `${short}.mp4`,
        `${standalone}.mp4`,
      ].sort()
    );
    expect(tree(path.join(e, "finished-videos"))).toEqual([
      path.basename(standaloneExport),
    ]);
    expect(tree(path.join(d, "raw-footage"))).toHaveLength(4);
  });

  it("refuses orphaned exports until the Export Hash rename is recorded", async () => {
    put(d, "finished-videos/course-oldhash.mp4");

    expect(refusalOf(await run("orphaned-exports"))).toMatchObject({
      _tag: "StorageDeleteRefusedError",
      reason: "exports-not-renamed",
    });
    expect(exists(d, "finished-videos/course-oldhash.mp4")).toBe(true);
  });

  it.each([
    "clip-mockups",
    "unused-footage",
    "shared-footage",
    "standalone-videos",
    "shorts",
    "course:anything",
    "raw-footage",
    "../raw-footage",
    "",
  ])("refuses %j outright, deleting nothing", async (bucketId) => {
    seedEverythingElse();
    markRenameDone();
    const before = [tree(d), tree(e)];

    expect(refusalOf(await run(bucketId))).toMatchObject({
      _tag: "StorageDeleteRefusedError",
      reason: "not-deletable",
    });
    expect([tree(d), tree(e)]).toEqual(before);
  });

  it("offers no delete for Clip Mockups or any Footage bucket", () => {
    const bucket = (
      id: string,
      kind: StorageBucket["kind"]
    ): StorageBucket => ({
      id,
      kind,
      name: id,
    });
    expect(bucketCanBeDeleted(bucket("clip-mockups", "clip-mockups"))).toBe(
      false
    );
    expect(bucketCanBeDeleted(bucket("unused-footage", "unused-footage"))).toBe(
      false
    );
    expect(bucketCanBeDeleted(bucket("shared-footage", "shared-footage"))).toBe(
      false
    );
    expect(bucketCanBeDeleted(bucket("course:x", "course"))).toBe(false);
    expect(
      bucketCanBeDeleted(bucket("overlay-render-cache", "overlay-render-cache"))
    ).toBe(true);
    expect(bucketCanBeDeleted(bucket("export-scratch", "export-scratch"))).toBe(
      true
    );
    expect(
      bucketCanBeDeleted(bucket("orphaned-exports", "orphaned-exports"))
    ).toBe(true);
  });

  it("never follows a symlink out of the bucket into raw Footage", async () => {
    put(d, "raw-footage/a.mkv", 100);
    put(d, "raw-footage/dir/b.mkv", 100);
    put(d, "overlay-renders/real.mov", 5);
    // A link to a take, a link to a folder of takes.
    fs.symlinkSync(
      path.join(d, "raw-footage/a.mkv"),
      path.join(d, "overlay-renders/link.mov")
    );
    fs.symlinkSync(
      path.join(d, "raw-footage/dir"),
      path.join(d, "overlay-renders/linked-dir")
    );
    // E:'s whole overlay-renders/ is a link to its raw Footage.
    put(e, "raw-footage/c.mkv", 100);
    fs.symlinkSync(
      path.join(e, "raw-footage"),
      path.join(e, "overlay-renders")
    );
    // Orphaned-looking names that are links to Footage.
    markRenameDone();
    fs.symlinkSync(
      path.join(d, "raw-footage/a.mkv"),
      path.join(d, "finished-videos/stale-link.mp4")
    );

    const overlays = await run("overlay-render-cache");
    const orphans = await run("orphaned-exports");

    expect(Exit.isSuccess(overlays)).toBe(true);
    const result = Exit.isSuccess(overlays) ? overlays.value : null;
    expect(result!.deleted).toEqual([{ location: d, files: 1, bytes: 5 }]);
    expect(result!.left.map((l) => [l.location, l.path])).toEqual([
      [d, "overlay-renders/link.mov"],
      [d, "overlay-renders/linked-dir"],
      [e, "overlay-renders"],
    ]);
    expect(result!.left[2]!.message).toContain("really is");
    expect(Exit.isSuccess(orphans)).toBe(true);
    expect(Exit.isSuccess(orphans) && orphans.value.deleted).toEqual([]);

    // Every take, and every link, is still there.
    expect(fs.readFileSync(path.join(d, "raw-footage/a.mkv"))).toHaveLength(
      100
    );
    expect(exists(d, "raw-footage/dir/b.mkv")).toBe(true);
    expect(exists(e, "raw-footage/c.mkv")).toBe(true);
    expect(fs.lstatSync(path.join(d, "overlay-renders/link.mov"))).toBeTruthy();
    expect(exists(d, "finished-videos/stale-link.mp4")).toBe(true);
  });

  it("refuses an export scratch folder that is, or holds, a Storage Root's Footage", async () => {
    put(d, "raw-footage/a.mkv", 100);

    const onRoot = await run("export-scratch", path.join(d, "raw-footage"));
    const holdsRoot = await run("export-scratch", base);
    const linked = path.join(base, "linked-scratch");
    fs.symlinkSync(path.join(d, "raw-footage"), linked);
    const viaLink = await run("export-scratch", linked);

    for (const exit of [onRoot, holdsRoot, viaLink]) {
      expect(Exit.isSuccess(exit) && exit.value.deleted).toEqual([]);
    }
    expect(exists(d, "raw-footage/a.mkv")).toBe(true);
  });

  it("deletes nothing outside the folder it is confined to (a verify run's own)", async () => {
    put(scratch, "pass-1.mp4");
    put(d, "overlay-renders/c1.mov");
    const runDir = path.join(base, "run");
    fs.mkdirSync(runDir);

    const exit = await run("export-scratch", scratch, runDir);
    const overlays = await run("overlay-render-cache", scratch, runDir);

    expect(Exit.isSuccess(exit) && exit.value.deleted).toEqual([]);
    expect(Exit.isSuccess(exit) && exit.value.left[0]!.message).toContain(
      "outside"
    );
    expect(Exit.isSuccess(overlays) && overlays.value.deleted).toEqual([]);
    expect(tree(scratch)).toEqual(["pass-1.mp4"]);
    expect(exists(d, "overlay-renders/c1.mov")).toBe(true);
  });

  it.skipIf(process.getuid?.() === 0)(
    "leaves and reports a file it can't delete, and deletes the rest",
    async () => {
      markRenameDone();
      put(d, "finished-videos/stale-a.mp4", 3);
      put(e, "finished-videos/stale-b.mp4", 4);
      // A folder that won't let go of its files (Windows holding one open).
      fs.chmodSync(path.join(d, "finished-videos"), 0o555);

      const exit = await run("orphaned-exports");

      expect(Exit.isSuccess(exit)).toBe(true);
      const result = Exit.isSuccess(exit) ? exit.value : null;
      expect(result!.deleted).toEqual([{ location: e, files: 1, bytes: 4 }]);
      expect(result!.left.map((l) => l.path)).toEqual([
        "finished-videos/stale-a.mp4",
      ]);
      expect(exists(d, "finished-videos/stale-a.mp4")).toBe(true);
    }
  );
});
