import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import * as schema from "../db/schema.js";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "../test-utils/test-db.js";
import type { Database } from "./drizzle-service.server.js";
import { migrateStoragePaths } from "./storage-path-migration.server.js";

let testDb: TestDb;

beforeAll(async () => {
  ({ testDb } = await createTestDb());
});

beforeEach(async () => {
  await truncateAllTables(testDb);
});

const db = () => testDb as unknown as Database;

const ROOTS = ["/mnt/d", "/mnt/e"];

async function seed() {
  const [video] = await testDb
    .insert(schema.videos)
    .values({
      title: "Standalone",
      originalFootagePath: "/mnt/d/raw-footage/original.mp4",
    })
    .returning();
  const videoId = video!.id;
  const [session] = await testDb
    .insert(schema.recordingSessions)
    .values({
      videoId,
      cameraFilePath: "/home/matt/Videos/s1/camera.mkv",
      screenFilePath: "/home/matt/Videos/s1/screen.mkv",
      micFilePath: "/mnt/e/raw-footage/s2/mic.mkv",
    })
    .returning();
  await testDb.insert(schema.clips).values([
    {
      videoId,
      videoFilename: "/mnt/d/raw-footage/a.mp4",
      sourceStartTime: 0,
      sourceEndTime: 1,
      order: "a0",
      text: "",
    },
    {
      videoId,
      videoFilename: "/mnt/e/raw-footage/b.mp4",
      sourceStartTime: 0,
      sourceEndTime: 1,
      order: "a1",
      text: "",
    },
    {
      videoId,
      // Under no root: a CVM-recorder take in ~/Videos.
      videoFilename: "/home/matt/Videos/s1/mic.mkv",
      sourceStartTime: 0,
      sourceEndTime: 1,
      order: "a2",
      text: "",
    },
    {
      videoId,
      // Looks like a root but is not under one: `/mnt/dd` is not `/mnt/d/`.
      videoFilename: "/mnt/dd/raw-footage/c.mp4",
      sourceStartTime: 0,
      sourceEndTime: 1,
      order: "a3",
      text: "",
    },
    {
      videoId,
      // Not in normal form: stripping the root would not give what the
      // Export Hash (which normalizes) uses, so it is left as stored.
      videoFilename: "/mnt/d/raw-footage//doubled.mp4",
      sourceStartTime: 0,
      sourceEndTime: 1,
      order: "a5",
      text: "",
    },
    {
      videoId,
      videoFilename: "raw-footage/already.mp4",
      sourceStartTime: 0,
      sourceEndTime: 1,
      order: "a4",
      text: "",
    },
  ]);
  await testDb.insert(schema.avCalibrations).values({
    outcome: "passed",
    noiseFloorDb: -60,
    speechLufs: -27,
    thresholdDb: -43,
    recorderMic: "mic",
    scriptVersion: 1,
    micFilePath: "/mnt/d/raw-footage/cal/mic.wav",
    browserTracePath: "/mnt/d/raw-footage/cal/browser-trace.json",
  });
  await testDb.insert(schema.thumbnails).values({
    videoId,
    layers: {},
    filePath: "/mnt/d/video-files/thumb.png",
  });
  return { videoId, sessionId: session!.id };
}

const clipPaths = async () =>
  (await testDb.select().from(schema.clips)).map((c) => c.videoFilename).sort();

describe("migrateStoragePaths", () => {
  it("a dry run reports what it would rewrite and writes nothing", async () => {
    await seed();
    const before = await clipPaths();

    const report = await migrateStoragePaths(db(), {
      roots: ROOTS,
      apply: false,
    });

    expect(report.applied).toBe(false);
    expect(await clipPaths()).toEqual(before);
    const clip = report.columns.find(
      (c) => c.column === "clip.video_filename"
    )!;
    expect(clip.underRoot).toEqual([
      { root: "/mnt/d", rows: 1 },
      { root: "/mnt/e", rows: 1 },
    ]);
    expect(clip.unmappable).toBe(2);
    expect(clip.unmappableSamples).toEqual([
      "/home/matt/Videos/s1/mic.mkv",
      "/mnt/dd/raw-footage/c.mp4",
    ]);
    expect(clip.notNormalized).toBe(1);
    expect(clip.alreadyRelative).toBe(1);
  });

  it("apply rewrites only the paths under a root, on every path column", async () => {
    const { sessionId } = await seed();

    await migrateStoragePaths(db(), { roots: ROOTS, apply: true });

    expect(await clipPaths()).toEqual([
      "/home/matt/Videos/s1/mic.mkv",
      "/mnt/d/raw-footage//doubled.mp4",
      "/mnt/dd/raw-footage/c.mp4",
      "raw-footage/a.mp4",
      "raw-footage/already.mp4",
      "raw-footage/b.mp4",
    ]);
    const [session] = await testDb.select().from(schema.recordingSessions);
    expect(session!.id).toBe(sessionId);
    expect(session!.cameraFilePath).toBe("/home/matt/Videos/s1/camera.mkv");
    expect(session!.micFilePath).toBe("raw-footage/s2/mic.mkv");
    const [video] = await testDb.select().from(schema.videos);
    expect(video!.originalFootagePath).toBe("raw-footage/original.mp4");
    const [cal] = await testDb.select().from(schema.avCalibrations);
    expect(cal!.micFilePath).toBe("raw-footage/cal/mic.wav");
    expect(cal!.browserTracePath).toBe("raw-footage/cal/browser-trace.json");
  });

  it("leaves thumbnails alone and reports them for #2105", async () => {
    await seed();

    const report = await migrateStoragePaths(db(), {
      roots: ROOTS,
      apply: true,
    });

    const [thumb] = await testDb.select().from(schema.thumbnails);
    expect(thumb!.filePath).toBe("/mnt/d/video-files/thumb.png");
    expect(report.reportedOnly[0]!.underRoot[0]).toEqual({
      root: "/mnt/d",
      rows: 1,
    });
  });

  it("is idempotent: a second apply rewrites nothing", async () => {
    await seed();
    await migrateStoragePaths(db(), { roots: ROOTS, apply: true });
    const after = await clipPaths();

    const second = await migrateStoragePaths(db(), {
      roots: ROOTS,
      apply: true,
    });

    expect(await clipPaths()).toEqual(after);
    for (const column of second.columns) {
      expect(column.underRoot.every((r) => r.rows === 0)).toBe(true);
    }
  });
});
