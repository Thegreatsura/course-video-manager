import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { Effect, Layer } from "effect";
import { CourseOperationsService } from "./db-course-operations.server.js";
import { DrizzleService } from "./drizzle-service.server.js";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "../test-utils/pglite.js";
import * as schema from "../db/schema.js";
import { eq } from "drizzle-orm";
import { sortByOrder } from "../lib/sort-by-order.js";

let testDb: TestDb;
let testLayer: Layer.Layer<CourseOperationsService>;

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;
  testLayer = CourseOperationsService.Default.pipe(
    Layer.provide(Layer.succeed(DrizzleService, testDb as any))
  );
});

beforeEach(async () => {
  await truncateAllTables(testDb);
});

const run = <A, E>(eff: Effect.Effect<A, E, CourseOperationsService>) =>
  Effect.runPromise(eff.pipe(Effect.provide(testLayer)));

async function createFullCourseStructure() {
  const [course] = await testDb
    .insert(schema.courses)
    .values({
      name: "Original Course",
      memory: "Some course notes",
    })
    .returning();

  const [version] = await testDb
    .insert(schema.courseVersions)
    .values({ repoId: course!.id, name: "v1" })
    .returning();

  // Two sections: one active, one archived
  const [activeSection] = await testDb
    .insert(schema.sections)
    .values({
      repoVersionId: version!.id,
      title: "01-intro",
      order: 1,
      description: "Introduction section",
    })
    .returning();

  await testDb.insert(schema.sections).values({
    repoVersionId: version!.id,
    title: "02-archived",
    order: 2,
    archivedAt: new Date(),
  });

  const [lesson] = await testDb
    .insert(schema.lessons)
    .values({
      sectionId: activeSection!.id,
      order: 1,
      title: "First Lesson",
      icon: "code",
      priority: 3,
      previousVersionLessonId: "some-old-lesson-id",
      authoringStatus: "done",
    })
    .returning();

  // Set previousVersionSectionId on the active section
  await testDb
    .update(schema.sections)
    .set({ previousVersionSectionId: "some-old-section-id" })
    .where(eq(schema.sections.id, activeSection!.id));

  const [video] = await testDb
    .insert(schema.videos)
    .values({
      lessonId: lesson!.id,
      title: "video-01.mp4",
      originalFootagePath: "/footage/raw-01.mp4",
    })
    .returning();

  // Clips: one active, one archived
  await testDb.insert(schema.clips).values([
    {
      videoId: video!.id,
      videoFilename: "clip-01.mp4",
      sourceStartTime: 0,
      sourceEndTime: 10,
      order: "a",
      text: "Hello world",
      pauseType: "intro",
    },
    {
      videoId: video!.id,
      videoFilename: "clip-02.mp4",
      sourceStartTime: 10,
      sourceEndTime: 20,
      order: "b",
      archived: true,
      text: "Archived clip",
      pauseType: "none",
    },
  ]);

  // Chapters: one active, one archived
  await testDb.insert(schema.chapters).values([
    {
      videoId: video!.id,
      name: "Section A",
      order: "a",
    },
    {
      videoId: video!.id,
      name: "Archived Section",
      order: "b",
      archived: true,
    },
  ]);

  // Beats: one active, one archived
  await testDb.insert(schema.beats).values([
    {
      videoId: video!.id,
      kind: "definition",
      title: "Active Beat",
      order: "a",
      archived: false,
    },
    {
      videoId: video!.id,
      kind: "quest",
      title: "Archived Beat",
      order: "b",
      archived: true,
    },
  ]);

  // Clip Mockups: two active (inserted out of order), one archived
  await testDb.insert(schema.clipMockups).values([
    {
      videoId: video!.id,
      line: "Second mockup line",
      imagePath: "frame-002.png",
      audioPath: "speech-002.wav",
      durationSeconds: 4.25,
      order: "a2",
    },
    {
      videoId: video!.id,
      line: "First mockup line",
      imagePath: "frame-001.png",
      audioPath: "speech-001.wav",
      durationSeconds: 1.5,
      order: "a1",
    },
    {
      videoId: video!.id,
      line: "Archived mockup line",
      imagePath: "frame-003.png",
      audioPath: "speech-003.wav",
      durationSeconds: 0.5,
      order: "a3",
      archived: true,
    },
  ]);

  // Clip Mockup Chapters share the Clip Mockups' order space, interleaved
  await testDb.insert(schema.clipMockupChapters).values([
    { videoId: video!.id, name: "Setup", order: "a0" },
    { videoId: video!.id, name: "The bug", order: "a1V" },
    { videoId: video!.id, name: "The fix", order: "a2V" },
    { videoId: video!.id, name: "Cut", order: "a4", archived: true },
  ]);

  // Thumbnails
  await testDb.insert(schema.thumbnails).values({
    videoId: video!.id,
    layers: JSON.stringify([{ type: "text", content: "thumb" }]),
    filePath: "/thumbs/01.png",
    selectedForUpload: true,
  });

  // Archived video
  await testDb.insert(schema.videos).values({
    lessonId: lesson!.id,
    title: "video-archived.mp4",
    originalFootagePath: "/footage/archived.mp4",
    archived: true,
  });

  return {
    course: course!,
    version: version!,
    activeSection: activeSection!,
    lesson: lesson!,
    video: video!,
  };
}

describe("duplicateCourse", () => {
  it("copies the original course's memory field", async () => {
    const { course } = await createFullCourseStructure();

    const result = await run(
      Effect.gen(function* () {
        const courseOps = yield* CourseOperationsService;
        return yield* courseOps.duplicateCourse({
          sourceCourseId: course.id,
          name: "Dup",
        });
      })
    );

    expect(result.course.memory).toBe("Some course notes");
  });

  it("creates exactly one draft version", async () => {
    const { course } = await createFullCourseStructure();

    const result = await run(
      Effect.gen(function* () {
        const courseOps = yield* CourseOperationsService;
        return yield* courseOps.duplicateCourse({
          sourceCourseId: course.id,
          name: "Dup",
        });
      })
    );

    const versions = await testDb.query.courseVersions.findMany({
      where: (v, { eq }) => eq(v.repoId, result.course.id),
    });

    expect(versions).toHaveLength(1);
    expect(versions[0]!.name).toBe("v1.0");
  });

  it("deep-copies sections with correct data and nulls previousVersionSectionId", async () => {
    const { course } = await createFullCourseStructure();

    const result = await run(
      Effect.gen(function* () {
        const courseOps = yield* CourseOperationsService;
        return yield* courseOps.duplicateCourse({
          sourceCourseId: course.id,
          name: "Dup",
        });
      })
    );

    const newSections = await testDb.query.sections.findMany({
      where: (s, { eq }) => eq(s.repoVersionId, result.version.id),
      orderBy: (s, { asc }) => asc(s.order),
    });

    // Only non-archived section copied
    expect(newSections).toHaveLength(1);
    expect(newSections[0]!.title).toBe("01-intro");
    expect(newSections[0]!.description).toBe("Introduction section");
    expect(newSections[0]!.order).toBe(1);
    expect(newSections[0]!.previousVersionSectionId).toBeNull();
  });

  it("deep-copies lessons with correct data and nulls previousVersionLessonId", async () => {
    const { course } = await createFullCourseStructure();

    const result = await run(
      Effect.gen(function* () {
        const courseOps = yield* CourseOperationsService;
        return yield* courseOps.duplicateCourse({
          sourceCourseId: course.id,
          name: "Dup",
        });
      })
    );

    const newSections = await testDb.query.sections.findMany({
      where: (s, { eq }) => eq(s.repoVersionId, result.version.id),
      with: { lessons: true },
    });

    const lessons = newSections[0]!.lessons;
    expect(lessons).toHaveLength(1);
    expect(lessons[0]!.title).toBe("First Lesson");
    expect(lessons[0]!.icon).toBe("code");
    expect(lessons[0]!.priority).toBe(3);
    expect(lessons[0]!.previousVersionLessonId).toBeNull();
  });

  it("copies only active rows at every level", async () => {
    const { course } = await createFullCourseStructure();

    const result = await run(
      Effect.gen(function* () {
        const courseOps = yield* CourseOperationsService;
        return yield* courseOps.duplicateCourse({
          sourceCourseId: course.id,
          name: "Dup",
        });
      })
    );

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

    const videos = newSections[0]!.lessons[0]!.videos;
    expect(videos.map((v) => v.title)).toEqual(["video-01.mp4"]);
    const video = videos[0]!;
    expect(video.clips.map((c) => c.videoFilename)).toEqual(["clip-01.mp4"]);
    expect(video.chapters.map((c) => c.name)).toEqual(["Section A"]);
    expect(video.beats.map((b) => b.title)).toEqual(["Active Beat"]);
  });
  it("preserves entity ordering across sections and lessons", async () => {
    const [course] = await testDb
      .insert(schema.courses)
      .values({ name: "Order Test" })
      .returning();

    const [version] = await testDb
      .insert(schema.courseVersions)
      .values({ repoId: course!.id, name: "v1" })
      .returning();

    // Create sections in reverse order values to verify ordering
    await testDb.insert(schema.sections).values([
      { repoVersionId: version!.id, title: "01-first", order: 1 },
      { repoVersionId: version!.id, title: "02-second", order: 2 },
      { repoVersionId: version!.id, title: "03-third", order: 3 },
    ]);

    const result = await run(
      Effect.gen(function* () {
        const courseOps = yield* CourseOperationsService;
        return yield* courseOps.duplicateCourse({
          sourceCourseId: course!.id,
          name: "Dup",
        });
      })
    );

    const newSections = await testDb.query.sections.findMany({
      where: (s, { eq }) => eq(s.repoVersionId, result.version.id),
      orderBy: (s, { asc }) => asc(s.order),
    });

    expect(newSections).toHaveLength(3);
    expect(newSections[0]!.title).toBe("01-first");
    expect(newSections[0]!.order).toBe(1);
    expect(newSections[1]!.title).toBe("02-second");
    expect(newSections[1]!.order).toBe(2);
    expect(newSections[2]!.title).toBe("03-third");
    expect(newSections[2]!.order).toBe(3);
  });

  it("fails with NotFoundError for non-existent source course", async () => {
    await expect(
      run(
        Effect.gen(function* () {
          const courseOps = yield* CourseOperationsService;
          return yield* courseOps.duplicateCourse({
            sourceCourseId: "non-existent-id",
            name: "Dup",
          });
        })
      )
    ).rejects.toThrow();
  });

  it("fails with NotFoundError when source course has no versions", async () => {
    const [course] = await testDb
      .insert(schema.courses)
      .values({ name: "No Versions" })
      .returning();

    await expect(
      run(
        Effect.gen(function* () {
          const courseOps = yield* CourseOperationsService;
          return yield* courseOps.duplicateCourse({
            sourceCourseId: course!.id,
            name: "Dup",
          });
        })
      )
    ).rejects.toThrow();
  });

  it("uses the latest version when multiple versions exist", async () => {
    const [course] = await testDb
      .insert(schema.courses)
      .values({ name: "Multi Version" })
      .returning();

    const [oldVersion] = await testDb
      .insert(schema.courseVersions)
      .values({ repoId: course!.id, name: "v1" })
      .returning();

    await testDb.insert(schema.sections).values({
      repoVersionId: oldVersion!.id,
      title: "01-old-section",
      order: 1,
    });

    const [newVersion] = await testDb
      .insert(schema.courseVersions)
      .values({ repoId: course!.id, name: "v2" })
      .returning();

    await testDb.insert(schema.sections).values({
      repoVersionId: newVersion!.id,
      title: "01-new-section",
      order: 1,
    });

    const result = await run(
      Effect.gen(function* () {
        const courseOps = yield* CourseOperationsService;
        return yield* courseOps.duplicateCourse({
          sourceCourseId: course!.id,
          name: "Dup",
        });
      })
    );

    const newSections = await testDb.query.sections.findMany({
      where: (s, { eq }) => eq(s.repoVersionId, result.version.id),
    });

    expect(newSections).toHaveLength(1);
    expect(newSections[0]!.title).toBe("01-new-section");
  });

  it("copies the Animatic in order, interleaved, without archived rows", async () => {
    const { course } = await createFullCourseStructure();

    const result = await run(
      Effect.gen(function* () {
        const courseOps = yield* CourseOperationsService;
        return yield* courseOps.duplicateCourse({
          sourceCourseId: course.id,
          name: "Dup",
        });
      })
    );

    const newSections = await testDb.query.sections.findMany({
      where: (s, { eq }) => eq(s.repoVersionId, result.version.id),
      with: {
        lessons: {
          with: {
            videos: { with: { clipMockups: true, clipMockupChapters: true } },
          },
        },
      },
    });

    // A MERGED order comparison, not a per-table count: only a merged list
    // catches the two halves arriving separated instead of interleaved.
    const video = newSections[0]!.lessons[0]!.videos[0]!;
    const animatic = sortByOrder([
      ...video.clipMockups.map((m) => ({
        order: m.order,
        label: `mockup:${m.line}${m.archived ? " (archived)" : ""}`,
      })),
      ...video.clipMockupChapters.map((c) => ({
        order: c.order,
        label: `chapter:${c.name}${c.archived ? " (archived)" : ""}`,
      })),
    ]).map((item) => item.label);
    expect(animatic).toEqual([
      "chapter:Setup",
      "mockup:First mockup line",
      "chapter:The bug",
      "mockup:Second mockup line",
      "chapter:The fix",
    ]);
  });
  it("reports each duplicated Video's source and new lineageId", async () => {
    const { course, video } = await createFullCourseStructure();

    const result = await run(
      Effect.gen(function* () {
        const courseOps = yield* CourseOperationsService;
        return yield* courseOps.duplicateCourse({
          sourceCourseId: course.id,
          name: "Dup",
        });
      })
    );

    // A duplicated Video is a NEW Video, so it gets a fresh lineageId while
    // its copied Clip Mockups keep their paths. `apps/local` carries the
    // frames and WAVs across on the strength of these pairs (#1669) —
    // `@cvm/core` has no disk to do it with.
    expect(result.videoLineageMappings).toHaveLength(1);

    const [mapping] = result.videoLineageMappings;
    expect(mapping!.sourceLineageId).toBe(video!.lineageId);
    expect(mapping!.newLineageId).not.toBe(video!.lineageId);

    const newVideo = await testDb.query.videos.findFirst({
      where: (v, { eq }) => eq(v.id, mapping!.newVideoId),
    });
    expect(newVideo!.lineageId).toBe(mapping!.newLineageId);
  });
});
