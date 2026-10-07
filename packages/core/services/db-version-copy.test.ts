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
import { eq, getTableColumns } from "drizzle-orm";

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

/**
 * What a Course Version snapshot carries forward, column by column. Same
 * pattern as db-duplicate-course-drift.test.ts: add a column to any table the
 * clone copies and the first test fails until it is classified here, and the
 * second proves every `copied` column really arrives on the clone.
 */
describe("copyVersionStructure — schema-drift guard", () => {
  const COPY_SPEC = {
    section: {
      table: schema.sections,
      copied: ["title", "description", "order", "lineageId"],
      // previousVersionSectionId points at the source row (asserted below).
      notCopied: [
        "id",
        "repoVersionId",
        "previousVersionSectionId",
        "archivedAt",
        "createdAt",
      ],
    },
    lesson: {
      table: schema.lessons,
      copied: [
        "title",
        "description",
        "icon",
        "priority",
        "dependencies",
        "authoringStatus",
        "order",
        "lineageId",
      ],
      notCopied: [
        "id",
        "sectionId",
        "previousVersionLessonId",
        "archived",
        "createdAt",
      ],
    },
    video: {
      table: schema.videos,
      copied: [
        "title",
        "originalFootagePath",
        "body",
        "description",
        "script",
        "format",
        "lineageId",
      ],
      // A course Video never has a pitchId (moving a Video into a Lesson
      // clears it), so there is nothing to carry.
      notCopied: [
        "id",
        "lessonId",
        "pitchId",
        "archived",
        "createdAt",
        "updatedAt",
      ],
    },
    clip: {
      table: schema.clips,
      copied: [
        "videoFilename",
        "sourceStartTime",
        "sourceEndTime",
        "order",
        "text",
        "transcribedAt",
        "scene",
        "profile",
        "pauseType",
        "zoomType",
        "diagramSnapshotId",
      ],
      notCopied: ["id", "videoId", "archived", "createdAt"],
    },
    chapter: {
      table: schema.chapters,
      copied: ["name", "order"],
      notCopied: ["id", "videoId", "archived", "createdAt"],
    },
    beat: {
      table: schema.beats,
      copied: ["kind", "title", "description", "order"],
      notCopied: ["id", "videoId", "archived", "createdAt"],
    },
    clipMockup: {
      table: schema.clipMockups,
      copied: ["line", "imagePath", "audioPath", "durationSeconds", "order"],
      notCopied: ["id", "videoId", "archived", "createdAt"],
    },
    clipMockupChapter: {
      table: schema.clipMockupChapters,
      copied: ["name", "order"],
      notCopied: ["id", "videoId", "archived", "createdAt"],
    },
    clipMockupComment: {
      table: schema.clipMockupComments,
      copied: ["body", "createdAt", "updatedAt"],
      notCopied: ["id", "videoId", "clipMockupId", "clipMockupChapterId"],
    },
    thumbnail: {
      table: schema.thumbnails,
      copied: ["layers", "filePath", "selectedForUpload"],
      notCopied: ["id", "videoId", "createdAt"],
    },
  } as const;

  async function getOne(table: any, column: string, value: string) {
    const rows = await testDb
      .select()
      .from(table)
      .where(eq(table[column], value));
    return rows[0];
  }

  it("declares every column of every copied table (add a column => this fails)", () => {
    for (const [name, spec] of Object.entries(COPY_SPEC)) {
      const actual = Object.keys(getTableColumns(spec.table)).sort();
      const declared = [...spec.copied, ...spec.notCopied].sort();
      expect(actual, `uncategorized column(s) on "${name}"`).toEqual(declared);
    }
  });

  it("carries over every copied column end-to-end", async () => {
    const { course, version } = await createCourseAndVersion();
    const [diagram] = await testDb
      .insert(schema.diagrams)
      .values({ name: "Coverage Diagram" })
      .returning();
    const [snapshot] = await testDb
      .insert(schema.diagramSnapshots)
      .values({
        diagramId: diagram!.id,
        scene: { nodes: [] },
        contentHash: "coverage-hash",
      })
      .returning();
    const [section] = await testDb
      .insert(schema.sections)
      .values({
        repoVersionId: version.id,
        title: "Coverage Section",
        description: "Section Description",
        order: 3,
      })
      .returning();
    const [lesson] = await testDb
      .insert(schema.lessons)
      .values({
        sectionId: section!.id,
        title: "Coverage Lesson",
        description: "Lesson Description",
        icon: "code",
        priority: 5,
        dependencies: ["dep-a", "dep-b"],
        authoringStatus: "in-progress",
        order: 7,
      })
      .returning();
    const [video] = await testDb
      .insert(schema.videos)
      .values({
        lessonId: lesson!.id,
        title: "coverage.mp4",
        originalFootagePath: "/footage/coverage.mp4",
        body: "# Lesson body",
        description: "SEO desc",
        script: "video teleprompter script",
        format: "short",
      })
      .returning();
    await testDb.insert(schema.clips).values({
      videoId: video!.id,
      videoFilename: "coverage-clip.mp4",
      sourceStartTime: 1.5,
      sourceEndTime: 9.5,
      order: "m",
      text: "clip text",
      transcribedAt: new Date("2026-01-01T00:00:00.000Z"),
      scene: "scene-1",
      profile: "profile-1",
      pauseType: "intro",
      zoomType: "subtle",
      diagramSnapshotId: snapshot!.id,
    });
    await testDb
      .insert(schema.chapters)
      .values({ videoId: video!.id, name: "Coverage Chapter", order: "m" });
    await testDb.insert(schema.beats).values({
      videoId: video!.id,
      kind: "quest",
      title: "Coverage Beat",
      description: "Beat Description",
      order: "m",
    });
    await testDb.insert(schema.clipMockups).values({
      videoId: video!.id,
      line: "Coverage Clip Mockup line",
      imagePath: "frame-001.png",
      audioPath: "speech-001.wav",
      durationSeconds: 2.75,
      order: "m",
    });
    const [mockupChapter] = await testDb
      .insert(schema.clipMockupChapters)
      .values({ videoId: video!.id, name: "Coverage Chapter", order: "mV" })
      .returning();
    await testDb.insert(schema.clipMockupComments).values({
      videoId: video!.id,
      clipMockupChapterId: mockupChapter!.id,
      body: "Coverage Clip Mockup Comment",
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-01-02T00:00:00Z"),
    });
    await testDb.insert(schema.thumbnails).values({
      videoId: video!.id,
      layers: [{ type: "text", content: "coverage" }],
      filePath: "/thumbs/coverage.png",
      selectedForUpload: true,
    });

    const result = await cloneVersion(course.id, version.id);

    const [newSection] = await testDb.query.sections.findMany({
      where: (s, { eq }) => eq(s.repoVersionId, result.version.id),
      with: {
        lessons: {
          with: {
            videos: {
              with: {
                clips: true,
                chapters: true,
                beats: true,
                clipMockups: true,
                clipMockupChapters: true,
                clipMockupComments: true,
                thumbnails: true,
              },
            },
          },
        },
      },
    });

    const newLesson = newSection!.lessons[0]!;
    const newVideo = newLesson.videos[0]!;
    const newRows: Record<keyof typeof COPY_SPEC, any> = {
      section: newSection!,
      lesson: newLesson,
      video: newVideo,
      clip: newVideo.clips[0]!,
      chapter: newVideo.chapters[0]!,
      beat: newVideo.beats[0]!,
      clipMockup: newVideo.clipMockups[0]!,
      clipMockupChapter: newVideo.clipMockupChapters[0]!,
      clipMockupComment: newVideo.clipMockupComments[0]!,
      thumbnail: newVideo.thumbnails[0]!,
    };
    const sourceRows: Record<keyof typeof COPY_SPEC, any> = {
      section: section!,
      lesson: lesson!,
      video: video!,
      clip: await getOne(schema.clips, "videoId", video!.id),
      chapter: await getOne(schema.chapters, "videoId", video!.id),
      beat: await getOne(schema.beats, "videoId", video!.id),
      clipMockup: await getOne(schema.clipMockups, "videoId", video!.id),
      clipMockupChapter: mockupChapter!,
      clipMockupComment: await getOne(
        schema.clipMockupComments,
        "videoId",
        video!.id
      ),
      thumbnail: await getOne(schema.thumbnails, "videoId", video!.id),
    };

    for (const [name, spec] of Object.entries(COPY_SPEC)) {
      const src = sourceRows[name as keyof typeof COPY_SPEC];
      const copy = newRows[name as keyof typeof COPY_SPEC];
      for (const col of spec.copied) {
        expect(copy[col], `"${name}.${col}" was not carried over`).toEqual(
          src[col]
        );
      }
    }

    // The clone links each structural row back to the one it came from.
    expect(newSection!.previousVersionSectionId).toBe(section!.id);
    expect(newLesson.previousVersionLessonId).toBe(lesson!.id);
  });
});

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
