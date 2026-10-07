import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { Effect, Layer } from "effect";
import { VersionOperationsService } from "./db-version-operations.server.js";
import { DrizzleService } from "./drizzle-service.server.js";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "../test-utils/pglite.js";
import * as schema from "../db/schema.js";
import { sortByOrder } from "../lib/sort-by-order.js";

let testDb: TestDb;
let testLayer: Layer.Layer<VersionOperationsService>;

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;
  testLayer = VersionOperationsService.Default.pipe(
    Layer.provide(Layer.succeed(DrizzleService, testDb as any))
  );
});

beforeEach(async () => {
  await truncateAllTables(testDb);
});

const run = <A, E>(eff: Effect.Effect<A, E, VersionOperationsService>) =>
  Effect.runPromise(eff.pipe(Effect.provide(testLayer)));

const cloneVersion = (repoId: string, sourceVersionId: string) =>
  run(
    Effect.gen(function* () {
      const versionOps = yield* VersionOperationsService;
      return yield* versionOps.copyVersionStructure({
        sourceVersionId,
        repoId,
        newVersionName: "v2",
      });
    })
  );

async function createCourseAndVersion() {
  const [course] = await testDb
    .insert(schema.courses)
    .values({ name: "Test Course" })
    .returning();
  const [version] = await testDb
    .insert(schema.courseVersions)
    .values({ repoId: course!.id, name: "v1" })
    .returning();
  return { course: course!, version: version! };
}

// Column-by-column coverage of Submit's copy lives in
// db-version-copy.round-trip.test.ts, generated from the schema.

/** A Video's Animatic as one named list, both tables merged by `order`. */
async function animaticLabels(videoId: string) {
  const mockups = await testDb.query.clipMockups.findMany({
    where: (m, { eq }) => eq(m.videoId, videoId),
  });
  const chapters = await testDb.query.clipMockupChapters.findMany({
    where: (c, { eq }) => eq(c.videoId, videoId),
  });
  return sortByOrder([
    ...mockups.map((m) => ({
      order: m.order,
      label: `mockup:${m.line}${m.archived ? " (archived)" : ""}`,
    })),
    ...chapters.map((c) => ({
      order: c.order,
      label: `chapter:${c.name}${c.archived ? " (archived)" : ""}`,
    })),
  ]).map((item) => item.label);
}

describe("copyVersionStructure", () => {
  it("copies only active rows at every level", async () => {
    const { course, version } = await createCourseAndVersion();
    const [section] = await testDb
      .insert(schema.sections)
      .values([
        { repoVersionId: version.id, title: "01-active", order: 1 },
        {
          repoVersionId: version.id,
          title: "02-archived",
          order: 2,
          archivedAt: new Date(),
        },
      ])
      .returning();
    const [lesson] = await testDb
      .insert(schema.lessons)
      .values([
        { sectionId: section!.id, order: 1, title: "Active Lesson" },
        {
          sectionId: section!.id,
          order: 2,
          title: "Archived Lesson",
          archived: true,
        },
      ])
      .returning();
    const [video] = await testDb
      .insert(schema.videos)
      .values([
        {
          lessonId: lesson!.id,
          title: "active.mp4",
          originalFootagePath: "/footage/active",
        },
        {
          lessonId: lesson!.id,
          title: "archived.mp4",
          originalFootagePath: "/footage/archived",
          archived: true,
        },
      ])
      .returning();
    const videoId = video!.id;
    await testDb.insert(schema.clips).values(
      [false, true].map((archived, i) => ({
        videoId,
        videoFilename: archived ? "archived.mp4" : "active.mp4",
        sourceStartTime: i * 10,
        sourceEndTime: i * 10 + 10,
        order: `a${i}`,
        text: "",
        archived,
      }))
    );
    await testDb.insert(schema.chapters).values([
      { videoId, name: "Active", order: "a0" },
      { videoId, name: "Archived", order: "a1", archived: true },
    ]);
    await testDb.insert(schema.beats).values([
      { videoId, kind: "definition", title: "Active", order: "a0" },
      {
        videoId,
        kind: "quest",
        title: "Archived",
        order: "a1",
        archived: true,
      },
    ]);
    // An Animatic whose Clip Mockups and Chapters share one order space,
    // inserted out of order: the clone must keep them interleaved as the
    // source has them, not piled at one end.
    await testDb.insert(schema.clipMockups).values(
      [
        { line: "Three", order: "a3" },
        { line: "One", order: "a1" },
        { line: "Two", order: "a2" },
        { line: "Cut line", order: "a5", archived: true },
      ].map((m) => ({
        videoId,
        imagePath: `${m.line}.png`,
        audioPath: `${m.line}.wav`,
        durationSeconds: 1,
        ...m,
      }))
    );
    await testDb.insert(schema.clipMockupChapters).values([
      { videoId, name: "Setup", order: "a0" },
      { videoId, name: "The bug", order: "a1V" },
      { videoId, name: "The fix", order: "a3V" },
      { videoId, name: "Cut", order: "a4", archived: true },
    ]);

    const result = await cloneVersion(course.id, version.id);

    const newSections = await testDb.query.sections.findMany({
      where: (s, { eq }) => eq(s.repoVersionId, result.version.id),
      with: {
        lessons: {
          with: {
            videos: { with: { clips: true, chapters: true, beats: true } },
          },
        },
      },
    });
    expect(newSections.map((s) => s.title)).toEqual(["01-active"]);
    const newLessons = newSections[0]!.lessons;
    expect(newLessons.map((l) => l.title)).toEqual(["Active Lesson"]);
    const newVideos = newLessons[0]!.videos;
    expect(newVideos.map((v) => v.title)).toEqual(["active.mp4"]);
    const newVideo = newVideos[0]!;
    expect(newVideo.clips.map((c) => c.videoFilename)).toEqual(["active.mp4"]);
    expect(newVideo.chapters.map((c) => c.name)).toEqual(["Active"]);
    expect(newVideo.beats.map((b) => b.title)).toEqual(["Active"]);

    // Archived Clip Mockups and Chapters are not copied at all, archived or
    // otherwise; the rest keep their interleaving.
    expect(await animaticLabels(newVideo.id)).toEqual([
      "chapter:Setup",
      "mockup:One",
      "chapter:The bug",
      "mockup:Two",
      "mockup:Three",
      "chapter:The fix",
    ]);
  });

  it("serializes concurrent clones from the same latest Course Version", async () => {
    const { course, version } = await createCourseAndVersion();

    const results = await Promise.allSettled([
      cloneVersion(course.id, version.id),
      cloneVersion(course.id, version.id),
    ]);

    expect(
      results.filter((result) => result.status === "fulfilled")
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected")
    ).toHaveLength(1);
    expect(
      await testDb.query.courseVersions.findMany({
        where: (row, { eq }) => eq(row.repoId, course.id),
      })
    ).toHaveLength(2);
  });
});

// The read that feeds Publish and Publish Readiness. It loads clips and
// chapters and nothing else per Video, which is the first of the two reasons
// a Clip Mockup can never reach a student (the second is that the shipped
// Video shape has no field for one — see course-json.test.ts). Adding a
// `clipMockups` sub-relation here would be the way to break that, so this
// test fails if anyone does.
describe("getVersionWithSections — the publish read", () => {
  it("does not load clip mockups", async () => {
    const { version } = await createCourseAndVersion();
    const [section] = await testDb
      .insert(schema.sections)
      .values({ repoVersionId: version.id, title: "01-intro", order: 1 })
      .returning();
    const [lesson] = await testDb
      .insert(schema.lessons)
      .values({
        sectionId: section!.id,
        order: 1,
        title: "01.01-welcome",
        authoringStatus: "done",
      })
      .returning();
    const [video] = await testDb
      .insert(schema.videos)
      .values({
        lessonId: lesson!.id,
        title: "video.mp4",
        originalFootagePath: "/footage/v1",
      })
      .returning();
    await testDb.insert(schema.clipMockups).values({
      videoId: video!.id,
      line: "And here is the bug.",
      imagePath: "frame-001.png",
      audioPath: "speech-001.wav",
      durationSeconds: 1.75,
      order: "a0",
    });

    const loaded = await run(
      Effect.gen(function* () {
        const versionOps = yield* VersionOperationsService;
        return yield* versionOps.getVersionWithSections(version.id);
      })
    );

    const loadedVideo = loaded.sections[0]!.lessons[0]!.videos[0]!;
    expect(loadedVideo).not.toHaveProperty("clipMockups");
    expect(loadedVideo).not.toHaveProperty("beats");
  });
});

describe("Submit (freezeAndCloneVersion) — the new Draft keeps how each Clip looks", () => {
  it("carries a Clip's zoom and pinned diagram snapshot, and the Video's format", async () => {
    const { course, version } = await createCourseAndVersion();
    const [diagram] = await testDb
      .insert(schema.diagrams)
      .values({ name: "Pinned Diagram" })
      .returning();
    const [snapshot] = await testDb
      .insert(schema.diagramSnapshots)
      .values({
        diagramId: diagram!.id,
        scene: { nodes: [] },
        contentHash: "pinned-hash",
      })
      .returning();
    const [section] = await testDb
      .insert(schema.sections)
      .values({ repoVersionId: version.id, title: "Section", order: 1 })
      .returning();
    const [lesson] = await testDb
      .insert(schema.lessons)
      .values({ sectionId: section!.id, order: 1, title: "Lesson" })
      .returning();
    const [video] = await testDb
      .insert(schema.videos)
      .values({
        lessonId: lesson!.id,
        title: "short.mp4",
        originalFootagePath: "/footage/short",
        format: "short",
      })
      .returning();
    await testDb.insert(schema.clips).values({
      videoId: video!.id,
      videoFilename: "take.mp4",
      sourceStartTime: 0,
      sourceEndTime: 5,
      order: "a0",
      text: "",
      zoomType: "subtle",
      diagramSnapshotId: snapshot!.id,
    });

    const result = await run(
      Effect.gen(function* () {
        const versionOps = yield* VersionOperationsService;
        return yield* versionOps.freezeAndCloneVersion({
          sourceVersionId: version.id,
          repoId: course.id,
          sourceName: "v1",
          sourceDescription: "",
        });
      })
    );

    const newVideoId = result.videoIdMappings[0]!.newVideoId;
    const newVideo = await testDb.query.videos.findFirst({
      where: (v, { eq }) => eq(v.id, newVideoId),
      with: { clips: true },
    });
    expect(newVideo!.format).toBe("short");
    expect(newVideo!.clips).toMatchObject([
      // Diagram Snapshots are content-addressed per Diagram, not per Version,
      // so the new Draft pins the very same snapshot row.
      { zoomType: "subtle", diagramSnapshotId: snapshot!.id },
    ]);
  });
});
