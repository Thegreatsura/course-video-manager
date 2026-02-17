import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "@/db/schema";
import { describe, it, expect } from "@effect/vitest";
import { vi, beforeEach } from "vitest";
import { Effect } from "effect";
import { pushSchema } from "drizzle-kit/api";
import { DBService } from "@/services/db-service";

let pglite: PGlite;
let testDb: ReturnType<typeof drizzle<typeof schema>>;

vi.mock("@/db/db", () => ({
  get db() {
    return testDb;
  },
}));

type InsertionPoint =
  | { type: "start" }
  | { type: "after-clip"; databaseClipId: string }
  | { type: "after-clip-section"; clipSectionId: string };

describe("appendClips", () => {
  let videoId: string;

  const appendClips = (insertionPoint: InsertionPoint, clipCount = 1) =>
    Effect.gen(function* () {
      const db = yield* DBService;
      return yield* db.appendClips({
        videoId,
        insertionPoint,
        clips: Array.from({ length: clipCount }, (_, i) => ({
          inputVideo: "test.mp4",
          startTime: i * 10,
          endTime: (i + 1) * 10,
        })),
      });
    });

  const createSection = (name: string, insertionPoint: InsertionPoint) =>
    Effect.gen(function* () {
      const db = yield* DBService;
      return yield* db.createClipSectionAtInsertionPoint(
        videoId,
        name,
        insertionPoint
      );
    });

  const getAllItemsSorted = () =>
    Effect.gen(function* () {
      const db = yield* DBService;
      const video = yield* db.getVideoWithClipsById(videoId);
      return [
        ...video.clips.map((c: any) => ({
          type: "clip" as const,
          id: c.id,
          order: c.order,
        })),
        ...video.clipSections.map((s: any) => ({
          type: "clip-section" as const,
          id: s.id,
          order: s.order,
        })),
      ].sort((a: any, b: any) =>
        a.order < b.order ? -1 : a.order > b.order ? 1 : 0
      );
    });

  beforeEach(async () => {
    pglite = new PGlite();
    testDb = drizzle(pglite, { schema });
    const { apply } = await pushSchema(schema, testDb as any);
    await apply();

    const video = await Effect.gen(function* () {
      const db = yield* DBService;
      return yield* db.createStandaloneVideo({ path: "test-video.mp4" });
    }).pipe(Effect.provide(DBService.Default), Effect.runPromise);
    videoId = video.id;
  });

  it.effect("inserts after a clip section", () =>
    Effect.gen(function* () {
      // Seed: [Clip A, Section, Clip B]
      const clipA = (yield* appendClips({ type: "start" }))[0]!;
      const section = yield* createSection("Section 1", {
        type: "after-clip",
        databaseClipId: clipA.id,
      });
      const clipB = (yield* appendClips({
        type: "after-clip-section",
        clipSectionId: section.id,
      }))[0]!;

      yield* appendClips({
        type: "after-clip-section",
        clipSectionId: section.id,
      });

      const items = yield* getAllItemsSorted();
      expect(items.map((i) => ({ type: i.type, id: i.id }))).toEqual([
        { type: "clip", id: clipA.id },
        { type: "clip-section", id: section.id },
        { type: "clip", id: expect.any(String) }, // New clip
        { type: "clip", id: clipB.id },
      ]);
    }).pipe(Effect.provide(DBService.Default))
  );

  it.effect("inserts after a clip (with section following)", () =>
    Effect.gen(function* () {
      // Seed: [Clip A, Section, Clip B]
      const clipA = (yield* appendClips({ type: "start" }))[0]!;
      const section = yield* createSection("Section 1", {
        type: "after-clip",
        databaseClipId: clipA.id,
      });
      const clipB = (yield* appendClips({
        type: "after-clip-section",
        clipSectionId: section.id,
      }))[0]!;

      yield* appendClips({
        type: "after-clip",
        databaseClipId: clipA.id,
      });

      const items = yield* getAllItemsSorted();
      expect(items.map((i) => ({ type: i.type, id: i.id }))).toEqual([
        { type: "clip", id: clipA.id },
        { type: "clip", id: expect.any(String) }, // New clip — before section
        { type: "clip-section", id: section.id },
        { type: "clip", id: clipB.id },
      ]);
    }).pipe(Effect.provide(DBService.Default))
  );

  it.effect("inserts at start", () =>
    Effect.gen(function* () {
      // Seed: [Section, Clip A]
      const section = yield* createSection("Section 1", { type: "start" });
      const clipA = (yield* appendClips({
        type: "after-clip-section",
        clipSectionId: section.id,
      }))[0]!;

      yield* appendClips({ type: "start" });

      const items = yield* getAllItemsSorted();
      expect(items.map((i) => ({ type: i.type, id: i.id }))).toEqual([
        { type: "clip", id: expect.any(String) }, // New clip
        { type: "clip-section", id: section.id },
        { type: "clip", id: clipA.id },
      ]);
    }).pipe(Effect.provide(DBService.Default))
  );

  it.effect("inserts after a clip section at end of timeline", () =>
    Effect.gen(function* () {
      // Seed: [Clip A, Section]
      const clipA = (yield* appendClips({ type: "start" }))[0]!;
      const section = yield* createSection("Section 1", {
        type: "after-clip",
        databaseClipId: clipA.id,
      });

      yield* appendClips({
        type: "after-clip-section",
        clipSectionId: section.id,
      });

      const items = yield* getAllItemsSorted();
      expect(items.map((i) => ({ type: i.type, id: i.id }))).toEqual([
        { type: "clip", id: clipA.id },
        { type: "clip-section", id: section.id },
        { type: "clip", id: expect.any(String) }, // New clip
      ]);
    }).pipe(Effect.provide(DBService.Default))
  );

  it.effect("inserts multiple clips after a section", () =>
    Effect.gen(function* () {
      // Seed: [Clip A, Section]
      const clipA = (yield* appendClips({ type: "start" }))[0]!;
      const section = yield* createSection("Section 1", {
        type: "after-clip",
        databaseClipId: clipA.id,
      });

      yield* appendClips(
        { type: "after-clip-section", clipSectionId: section.id },
        3
      );

      const items = yield* getAllItemsSorted();
      expect(items.length).toBe(5); // clip-a + section + 3 new clips
      expect(items[0]!.id).toBe(clipA.id);
      expect(items[1]!.id).toBe(section.id);
      // All 3 new clips should be after the section
      expect(items[2]!.type).toBe("clip");
      expect(items[3]!.type).toBe("clip");
      expect(items[4]!.type).toBe("clip");
    }).pipe(Effect.provide(DBService.Default))
  );
});
