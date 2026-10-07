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

const submit = (repoId: string, sourceVersionId: string) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const versionOps = yield* VersionOperationsService;
      return yield* versionOps.freezeAndCloneVersion({
        sourceVersionId,
        repoId,
        sourceName: "v1",
        sourceDescription: "",
      });
    }).pipe(Effect.provide(testLayer))
  );

/**
 * A Draft whose Section has Learning Goals served by Beats, and whose Clip has
 * Web Links, Transcript Words and an Overlay — everything Submit used to drop.
 */
async function draftWithChildren() {
  const [course] = await testDb
    .insert(schema.courses)
    .values({ name: "Course" })
    .returning();
  const [version] = await testDb
    .insert(schema.courseVersions)
    .values({ repoId: course!.id, name: "v1" })
    .returning();
  const [section] = await testDb
    .insert(schema.sections)
    .values({ repoVersionId: version!.id, title: "Section", order: 1 })
    .returning();
  const [goal, deletedGoal] = await testDb
    .insert(schema.learningGoals)
    .values([
      {
        sectionId: section!.id,
        title: "Knows what a Beat is",
        description: "and why it is not a Chapter",
        priority: 1,
        order: 2,
      },
      {
        sectionId: section!.id,
        title: "Deleted goal",
        order: 3,
        archived: true,
      },
    ])
    .returning();
  const [lesson] = await testDb
    .insert(schema.lessons)
    .values({ sectionId: section!.id, title: "Lesson", order: 1 })
    .returning();
  const [video] = await testDb
    .insert(schema.videos)
    .values({ lessonId: lesson!.id, title: "v.mp4", originalFootagePath: "/f" })
    .returning();
  const [beat, deletedBeat] = await testDb
    .insert(schema.beats)
    .values([
      { videoId: video!.id, kind: "definition", title: "Beat", order: "a0" },
      {
        videoId: video!.id,
        kind: "quest",
        title: "Deleted beat",
        order: "a1",
        archived: true,
      },
    ])
    .returning();
  await testDb.insert(schema.beatLearningGoals).values([
    { beatId: beat!.id, learningGoalId: goal!.id },
    { beatId: deletedBeat!.id, learningGoalId: goal!.id },
  ]);
  const [clip] = await testDb
    .insert(schema.clips)
    .values({
      videoId: video!.id,
      videoFilename: "take.mp4",
      sourceStartTime: 0,
      sourceEndTime: 5,
      order: "a0",
      text: "hello world",
    })
    .returning();
  await testDb.insert(schema.clipWebLinks).values({
    clipId: clip!.id,
    url: "https://example.com/docs",
    title: "Docs",
    capturedAt: new Date("2026-01-01T00:00:00Z"),
  });
  await testDb.insert(schema.clipTranscriptWords).values([
    { clipId: clip!.id, start: 0.1, end: 0.4, text: "hello" },
    { clipId: clip!.id, start: 0.5, end: 0.9, text: "world" },
  ]);
  await testDb.insert(schema.overlays).values({
    clipId: clip!.id,
    at: 1.25,
    durationInSeconds: 3,
    kind: "bulletPanel",
    disableEnterAnimation: true,
    title: "Three things",
    description: "",
    bullets: [{ icon: "check", text: "One", revealAt: 0 }],
  });
  await testDb
    .insert(schema.videoPosts)
    .values({ videoId: video!.id, platform: "youtube", remoteId: "abc" });
  return { course: course!, version: version!, goal: goal!, deletedGoal };
}

describe("Submit (freezeAndCloneVersion) — the new Draft keeps every child row", () => {
  it("carries the Section's live Learning Goals onto the new Section", async () => {
    const { course, version, goal } = await draftWithChildren();

    const result = await submit(course.id, version.id);

    const [newSection] = await testDb.query.sections.findMany({
      where: (s, { eq }) => eq(s.repoVersionId, result.version.id),
      with: { learningGoals: true },
    });
    expect(newSection!.learningGoals).toEqual([
      expect.objectContaining({
        title: goal.title,
        description: goal.description,
        priority: goal.priority,
        order: goal.order,
        archived: false,
      }),
    ]);
    expect(newSection!.learningGoals[0]!.id).not.toBe(goal.id);
  });

  it("re-points each live Beat's Learning Goal link at the new Beat and new Goal", async () => {
    const { course, version } = await draftWithChildren();

    const result = await submit(course.id, version.id);

    const newVideo = await testDb.query.videos.findFirst({
      where: (v, { eq }) => eq(v.id, result.videoIdMappings[0]!.newVideoId),
      with: { beats: { with: { beatLearningGoals: true } } },
    });
    const [newSection] = await testDb.query.sections.findMany({
      where: (s, { eq }) => eq(s.repoVersionId, result.version.id),
      with: { learningGoals: true },
    });
    expect(newVideo!.beats).toHaveLength(1);
    expect(newVideo!.beats[0]!.beatLearningGoals).toEqual([
      {
        beatId: newVideo!.beats[0]!.id,
        learningGoalId: newSection!.learningGoals[0]!.id,
      },
    ]);
  });

  it("carries each Clip's Web Links, Transcript Words and Overlays", async () => {
    const { course, version } = await draftWithChildren();

    const result = await submit(course.id, version.id);

    const newVideo = await testDb.query.videos.findFirst({
      where: (v, { eq }) => eq(v.id, result.videoIdMappings[0]!.newVideoId),
      with: {
        clips: {
          with: { webLinks: true, transcriptWords: true, overlays: true },
        },
        videoPosts: true,
      },
    });
    const newClip = newVideo!.clips[0]!;
    expect(newClip.webLinks).toMatchObject([
      {
        clipId: newClip.id,
        url: "https://example.com/docs",
        title: "Docs",
        capturedAt: new Date("2026-01-01T00:00:00Z"),
      },
    ]);
    expect(
      newClip.transcriptWords
        .toSorted((a, b) => a.start - b.start)
        .map((w) => [w.start, w.end, w.text])
    ).toEqual([
      [0.1, 0.4, "hello"],
      [0.5, 0.9, "world"],
    ]);
    expect(newClip.overlays).toMatchObject([
      {
        clipId: newClip.id,
        at: 1.25,
        durationInSeconds: 3,
        kind: "bulletPanel",
        disableEnterAnimation: true,
        disableExitAnimation: false,
        title: "Three things",
        bullets: [{ icon: "check", text: "One", revealAt: 0 }],
      },
    ]);
    // A Video Post records where THAT Video row was posted; the copy never was.
    expect(newVideo!.videoPosts).toEqual([]);
  });
});
