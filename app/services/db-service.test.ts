import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "@/db/schema";
import { clips, clipSections, videos } from "@/db/schema";
import { asc, eq, and } from "drizzle-orm";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { Effect } from "effect";
import { generateNKeysBetween } from "fractional-indexing";

let pglite: PGlite;
let testDb: ReturnType<typeof drizzle<typeof schema>>;

vi.mock("@/db/db", () => ({
  get db() {
    return testDb;
  },
}));

const createTables = async () => {
  await pglite.exec(`
    CREATE TABLE IF NOT EXISTS "course-video-manager_video" (
      "id" varchar(255) PRIMARY KEY NOT NULL,
      "lesson_id" varchar(255),
      "path" text NOT NULL,
      "original_footage_path" text NOT NULL DEFAULT '',
      "archived" boolean NOT NULL DEFAULT false,
      "created_at" timestamp with time zone
    );

    CREATE TABLE IF NOT EXISTS "course-video-manager_clip" (
      "id" varchar(255) PRIMARY KEY NOT NULL,
      "video_id" varchar(255) NOT NULL REFERENCES "course-video-manager_video"("id") ON DELETE CASCADE,
      "video_filename" text NOT NULL,
      "source_start_time" double precision NOT NULL,
      "source_end_time" double precision NOT NULL,
      "created_at" timestamp with time zone,
      "order" varchar(255) COLLATE "C" NOT NULL,
      "archived" boolean NOT NULL DEFAULT false,
      "text" text NOT NULL,
      "transcribed_at" timestamp with time zone,
      "scene" varchar(255),
      "profile" varchar(255),
      "beat_type" varchar(255) NOT NULL DEFAULT 'none'
    );

    CREATE TABLE IF NOT EXISTS "course-video-manager_clip_section" (
      "id" varchar(255) PRIMARY KEY NOT NULL,
      "video_id" varchar(255) NOT NULL REFERENCES "course-video-manager_video"("id") ON DELETE CASCADE,
      "name" text NOT NULL,
      "order" varchar(255) COLLATE "C" NOT NULL,
      "archived" boolean NOT NULL DEFAULT false,
      "created_at" timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
};

const TEST_VIDEO_ID = "test-video-1";

const seedVideo = async () => {
  await testDb.insert(videos).values({
    id: TEST_VIDEO_ID,
    path: "test-video.mp4",
    originalFootagePath: "",
    lessonId: null,
  });
};

const insertClip = async (id: string, order: string) => {
  await testDb.insert(clips).values({
    id,
    videoId: TEST_VIDEO_ID,
    videoFilename: "test.mp4",
    sourceStartTime: 0,
    sourceEndTime: 1,
    order,
    archived: false,
    text: "",
    beatType: "none",
  });
};

const insertClipSection = async (id: string, order: string, name: string) => {
  await testDb.insert(clipSections).values({
    id,
    videoId: TEST_VIDEO_ID,
    name,
    order,
    archived: false,
  });
};

/**
 * Query all non-archived clips and clip sections for the test video,
 * sorted by order with COLLATE "C" semantics (ASCII byte ordering).
 */
const getAllItemsSorted = async () => {
  const allClips = await testDb.query.clips.findMany({
    where: and(eq(clips.videoId, TEST_VIDEO_ID), eq(clips.archived, false)),
    orderBy: asc(clips.order),
  });
  const allSections = await testDb.query.clipSections.findMany({
    where: and(
      eq(clipSections.videoId, TEST_VIDEO_ID),
      eq(clipSections.archived, false)
    ),
    orderBy: asc(clipSections.order),
  });

  const combined = [
    ...allClips.map((c) => ({
      type: "clip" as const,
      id: c.id,
      order: c.order,
    })),
    ...allSections.map((s) => ({
      type: "clip-section" as const,
      id: s.id,
      order: s.order,
    })),
  ].sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0));

  return combined;
};

describe("appendClips", () => {
  beforeEach(async () => {
    pglite = new PGlite();
    testDb = drizzle(pglite, { schema });
    await createTables();
    await seedVideo();
  });

  const runAppendClips = async (
    insertionPoint:
      | { type: "start" }
      | { type: "after-clip"; databaseClipId: string }
      | { type: "after-clip-section"; clipSectionId: string },
    clipCount = 1
  ) => {
    // Dynamic import to pick up the mock
    const { DBService } = await import("@/services/db-service");

    const inputClips = Array.from({ length: clipCount }, (_, i) => ({
      inputVideo: "test.mp4",
      startTime: i * 10,
      endTime: (i + 1) * 10,
    }));

    return Effect.gen(function* () {
      const db = yield* DBService;
      return yield* db.appendClips({
        videoId: TEST_VIDEO_ID,
        insertionPoint,
        clips: inputClips,
      });
    }).pipe(Effect.provide(DBService.Default), Effect.runPromise);
  };

  it("inserts after a clip section", async () => {
    // Seed: [Clip A, Section, Clip B]
    const orders = generateNKeysBetween(null, null, 3);
    await insertClip("clip-a", orders[0]!);
    await insertClipSection("section-1", orders[1]!, "Section 1");
    await insertClip("clip-b", orders[2]!);

    await runAppendClips({
      type: "after-clip-section",
      clipSectionId: "section-1",
    });

    const items = await getAllItemsSorted();
    expect(items.map((i) => ({ type: i.type, id: i.id }))).toEqual([
      { type: "clip", id: "clip-a" },
      { type: "clip-section", id: "section-1" },
      { type: "clip", id: expect.any(String) }, // New clip
      { type: "clip", id: "clip-b" },
    ]);
  });

  it("inserts after a clip (with section following)", async () => {
    // Seed: [Clip A, Section, Clip B]
    const orders = generateNKeysBetween(null, null, 3);
    await insertClip("clip-a", orders[0]!);
    await insertClipSection("section-1", orders[1]!, "Section 1");
    await insertClip("clip-b", orders[2]!);

    await runAppendClips({
      type: "after-clip",
      databaseClipId: "clip-a",
    });

    const items = await getAllItemsSorted();
    expect(items.map((i) => ({ type: i.type, id: i.id }))).toEqual([
      { type: "clip", id: "clip-a" },
      { type: "clip", id: expect.any(String) }, // New clip — before section
      { type: "clip-section", id: "section-1" },
      { type: "clip", id: "clip-b" },
    ]);
  });

  it("inserts at start", async () => {
    // Seed: [Section, Clip A]
    const orders = generateNKeysBetween(null, null, 2);
    await insertClipSection("section-1", orders[0]!, "Section 1");
    await insertClip("clip-a", orders[1]!);

    await runAppendClips({ type: "start" });

    const items = await getAllItemsSorted();
    expect(items.map((i) => ({ type: i.type, id: i.id }))).toEqual([
      { type: "clip", id: expect.any(String) }, // New clip
      { type: "clip-section", id: "section-1" },
      { type: "clip", id: "clip-a" },
    ]);
  });

  it("inserts after a clip section at end of timeline", async () => {
    // Seed: [Clip A, Section]
    const orders = generateNKeysBetween(null, null, 2);
    await insertClip("clip-a", orders[0]!);
    await insertClipSection("section-1", orders[1]!, "Section 1");

    await runAppendClips({
      type: "after-clip-section",
      clipSectionId: "section-1",
    });

    const items = await getAllItemsSorted();
    expect(items.map((i) => ({ type: i.type, id: i.id }))).toEqual([
      { type: "clip", id: "clip-a" },
      { type: "clip-section", id: "section-1" },
      { type: "clip", id: expect.any(String) }, // New clip
    ]);
  });

  it("inserts multiple clips after a section", async () => {
    // Seed: [Clip A, Section]
    const orders = generateNKeysBetween(null, null, 2);
    await insertClip("clip-a", orders[0]!);
    await insertClipSection("section-1", orders[1]!, "Section 1");

    await runAppendClips(
      { type: "after-clip-section", clipSectionId: "section-1" },
      3
    );

    const items = await getAllItemsSorted();
    expect(items.length).toBe(5); // clip-a + section + 3 new clips
    expect(items[0]!.id).toBe("clip-a");
    expect(items[1]!.id).toBe("section-1");
    // All 3 new clips should be after the section
    expect(items[2]!.type).toBe("clip");
    expect(items[3]!.type).toBe("clip");
    expect(items[4]!.type).toBe("clip");
  });
});
