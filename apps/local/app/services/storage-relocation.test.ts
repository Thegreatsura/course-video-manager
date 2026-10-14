import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NodeContext } from "@effect/platform-node";
import { Effect, Either } from "effect";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/test-db";
import type { Database } from "@/services/drizzle-service.server";
import type { StorageRoots } from "@/packages/storage";
import { listVideosForExportHash } from "@cvm/core/services/db-export-hash-videos.server";
import { computeExportHash, toExportClips } from "./export-hash";
import { EXPORT_HASH_RENAME_MARKER } from "./export-hash-rename";
import { applyRelocation, planRelocation } from "./storage-relocation.server";

/**
 * The one-off relocation (#2105) on PGlite and real temp directories: D: and
 * E: are temp Storage Roots, `home/Videos` is where the CVM recorder used to
 * write, `legacy/` is the old in-checkout Video Files store and `wt/` an old
 * `.worktrees` checkout. It must move everything it should, or nothing.
 */

let testDb: TestDb;
let base: string;
let d: string;
let roots: StorageRoots;
let legacy: string;
let sessionDir: string;
let worktreeThumb: string;

const db = () => testDb as unknown as Database;
const run = <A, E>(effect: Effect.Effect<A, E, NodeContext.NodeContext>) =>
  Effect.runPromise(effect.pipe(Effect.provide(NodeContext.layer)));

const write = (file: string, contents: string) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
  return file;
};

beforeAll(async () => {
  ({ testDb } = await createTestDb());
});

beforeEach(async () => {
  await truncateAllTables(testDb);
  base = fs.mkdtempSync(path.join(os.tmpdir(), "relocate-"));
  d = path.join(base, "d");
  const e = path.join(base, "e");
  fs.mkdirSync(path.join(d, "finished-videos"), { recursive: true });
  fs.mkdirSync(e);
  roots = [d, e];
  legacy = path.join(base, "checkout", "apps", "local", "video-files");
  sessionDir = path.join(
    base,
    "home",
    "Videos",
    "2026-10-01T10-00-00 abcd1234"
  );
});

afterEach(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

/** A Standalone Video with one CVM-recorder Clip, a Video File and Thumbnails. */
const seed = async () => {
  const mic = write(path.join(sessionDir, "mic.mkv"), "mic");
  write(path.join(sessionDir, "camera.mkv"), "camera");
  write(path.join(sessionDir, "screen.mkv"), "screen");
  write(path.join(sessionDir, "events.jsonl"), "{}");

  const [video] = await testDb
    .insert(schema.videos)
    .values({ title: "Standalone", originalFootagePath: "" })
    .returning();
  const lineage = video!.lineageId;
  const [session] = await testDb
    .insert(schema.recordingSessions)
    .values({
      videoId: video!.id,
      cameraFilePath: path.join(sessionDir, "camera.mkv"),
      screenFilePath: path.join(sessionDir, "screen.mkv"),
      micFilePath: mic,
    })
    .returning();
  await testDb.insert(schema.clips).values({
    videoId: video!.id,
    videoFilename: mic,
    recordingSessionId: session!.id,
    sourceStartTime: 0,
    sourceEndTime: 2,
    order: "a0",
    text: "",
  });

  write(path.join(legacy, lineage, "notes.md"), "notes");
  const legacyThumb = write(
    path.join(legacy, lineage, "thumbnail-1.png"),
    "png 1"
  );
  // Written from a worktree that still exists, and one that is gone.
  worktreeThumb = write(
    path.join(
      base,
      "checkout",
      ".worktrees",
      "wt",
      "video-files",
      lineage,
      "thumbnail-2.png"
    ),
    "png 2"
  );
  const goneThumb = path.join(
    base,
    "checkout",
    ".worktrees",
    "gone",
    "video-files",
    lineage,
    "thumbnail-3.png"
  );
  const layers = (filePath: string) => ({
    backgroundPhoto: { filePath, horizontalPosition: 0 },
    diagram: null,
    cutout: null,
  });
  const [t1, t2, t3] = await testDb
    .insert(schema.thumbnails)
    .values([
      {
        videoId: video!.id,
        filePath: legacyThumb,
        layers: layers(legacyThumb),
      },
      {
        videoId: video!.id,
        filePath: worktreeThumb,
        layers: layers(worktreeThumb),
      },
      { videoId: video!.id, filePath: goneThumb, layers: layers(goneThumb) },
    ])
    .returning();

  // Its Exported Video, named by today's Export Hash; #2104's rename has run.
  const hash = await currentHash(video!.id);
  const exported = write(
    path.join(d, "finished-videos", `${video!.id}-${hash}.mp4`),
    "mp4"
  );
  write(path.join(d, "finished-videos", EXPORT_HASH_RENAME_MARKER), "{}");

  return {
    video: video!,
    session: session!,
    lineage,
    exported,
    goneThumb,
    thumbs: [t1!, t2!, t3!] as const,
  };
};

const currentHash = async (videoId: string) => {
  const video = (await listVideosForExportHash(db())).find(
    (v) => v.id === videoId
  )!;
  return computeExportHash(toExportClips(video.clips), video.format, roots);
};

const plan = () =>
  run(planRelocation(db(), { roots, legacyVideoFilesStores: [legacy] }));

/** Every file under the temp tree, with its contents: "nothing changed". */
const snapshot = () =>
  fs
    .readdirSync(base, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name))
    .sort()
    .map((file) => `${file}=${fs.readFileSync(file, "utf8")}`);

const rows = async () => ({
  sessions: await testDb.select().from(schema.recordingSessions),
  clips: await testDb.select().from(schema.clips),
  thumbnails: await testDb.select().from(schema.thumbnails),
});

describe("storage relocation", () => {
  it("plans every move as a dry run, changing nothing", async () => {
    await seed();
    const before = { files: snapshot(), rows: await rows() };

    const planned = await plan();

    expect(planned.problems).toEqual([]);
    expect(planned.copies.map((c) => path.relative(d, c.to)).sort()).toEqual(
      expect.arrayContaining([
        "raw-footage/2026-10-01T10-00-00 abcd1234/mic.mkv",
        "raw-footage/2026-10-01T10-00-00 abcd1234/events.jsonl",
      ])
    );
    expect(planned.exportRenames).toHaveLength(1);
    expect({ files: snapshot(), rows: await rows() }).toEqual(before);
  });

  it("moves sessions, Video Files and thumbnails onto the first root, rewrites their rows and renames the export", async () => {
    const { video, session, lineage, exported, goneThumb, thumbs } =
      await seed();
    const folder = "raw-footage/2026-10-01T10-00-00 abcd1234";

    const planned = await plan();
    await run(applyRelocation(db(), planned, roots));

    const after = await rows();
    expect(after.sessions.find((s) => s.id === session.id)).toMatchObject({
      cameraFilePath: `${folder}/camera.mkv`,
      screenFilePath: `${folder}/screen.mkv`,
      micFilePath: `${folder}/mic.mkv`,
    });
    expect(after.clips[0]!.videoFilename).toBe(`${folder}/mic.mkv`);
    expect(fs.readFileSync(path.join(d, folder, "mic.mkv"), "utf8")).toBe(
      "mic"
    );
    expect(fs.existsSync(sessionDir)).toBe(false);

    expect(
      fs.readFileSync(path.join(d, "video-files", lineage, "notes.md"), "utf8")
    ).toBe("notes");
    expect(fs.existsSync(path.join(legacy, lineage, "notes.md"))).toBe(false);

    const thumb = (id: string) => after.thumbnails.find((t) => t.id === id)!;
    expect(thumb(thumbs[0].id).filePath).toBe(
      `video-files/${lineage}/thumbnail-1.png`
    );
    // The broken `.worktrees` path is repaired: the file is copied in.
    expect(thumb(thumbs[1].id)).toMatchObject({
      filePath: `video-files/${lineage}/thumbnail-2.png`,
      layers: {
        backgroundPhoto: { filePath: `video-files/${lineage}/thumbnail-2.png` },
      },
    });
    expect(
      fs.readFileSync(
        path.join(d, "video-files", lineage, "thumbnail-2.png"),
        "utf8"
      )
    ).toBe("png 2");
    // A file that is nowhere is reported and its row left alone.
    expect(planned.missing).toContain(
      `thumbnail ${thumbs[2].id}: ${goneThumb}`
    );
    expect(thumb(thumbs[2].id).filePath).toBe(goneThumb);

    // The export now has the address its Video's new rows compute.
    expect(fs.existsSync(exported)).toBe(false);
    const renamed = path.join(
      d,
      "finished-videos",
      `${video.id}-${await currentHash(video.id)}.mp4`
    );
    expect(fs.readFileSync(renamed, "utf8")).toBe("mp4");

    // Run again: nothing left to do.
    const again = await plan();
    expect([
      again.copies,
      again.rows,
      again.exportRenames,
      again.problems,
    ]).toEqual([[], [], [], []]);
  });

  it("aborts with zero changes when a copy fails", async () => {
    await seed();
    fs.chmodSync(path.join(sessionDir, "screen.mkv"), 0o000);
    const before = await rows();

    const result = await run(
      Effect.either(applyRelocation(db(), await plan(), roots))
    );

    fs.chmodSync(path.join(sessionDir, "screen.mkv"), 0o644);
    expect(Either.isLeft(result)).toBe(true);
    expect(await rows()).toEqual(before);
    expect(
      fs
        .readdirSync(path.join(d, "raw-footage"), { recursive: true })
        .filter(
          (f) =>
            !fs.statSync(path.join(d, "raw-footage", String(f))).isDirectory()
        )
    ).toEqual([]);
    expect(fs.existsSync(path.join(sessionDir, "mic.mkv"))).toBe(true);
    expect(fs.existsSync(path.join(legacy))).toBe(true);
  });

  it("refuses to run before the Exported Videos have their root-relative names", async () => {
    await seed();
    fs.rmSync(path.join(d, "finished-videos", EXPORT_HASH_RENAME_MARKER));

    const planned = await plan();

    expect(planned.problems).toEqual([
      expect.stringContaining("pnpm storage:rename-exports --apply"),
    ]);
    const result = await run(
      Effect.either(applyRelocation(db(), planned, roots))
    );
    expect(Either.isLeft(result)).toBe(true);
    expect(fs.existsSync(path.join(sessionDir, "mic.mkv"))).toBe(true);
  });
});
