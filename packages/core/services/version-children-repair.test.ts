import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "../test-utils/pglite.js";
import * as schema from "../db/schema.js";
import { eq } from "drizzle-orm";
import type { Database } from "./drizzle-service.server.js";
import { runVersionChildrenRepair } from "./version-children-repair.server.js";

let testDb: TestDb;

beforeAll(async () => {
  testDb = (await createTestDb()).testDb;
});

beforeEach(async () => {
  await truncateAllTables(testDb);
});

const db = () => testDb as unknown as Database;

/**
 * One Version of a Course holding one Section (lineage "sec"), one Lesson, one
 * Video (lineage "vid") with a Beat "Explain", and one Clip of take.mp4 0-5s.
 */
async function version(
  courseId: string,
  commitState: "draft" | "published",
  createdAt: string
) {
  const [v] = await testDb
    .insert(schema.courseVersions)
    .values({
      repoId: courseId,
      name: createdAt,
      commitState,
      createdAt: new Date(createdAt),
    })
    .returning();
  const [section] = await testDb
    .insert(schema.sections)
    .values({ repoVersionId: v!.id, lineageId: "sec", title: "S", order: 1 })
    .returning();
  const [lesson] = await testDb
    .insert(schema.lessons)
    .values({ sectionId: section!.id, title: "L", order: 1 })
    .returning();
  const [video] = await testDb
    .insert(schema.videos)
    .values({
      lessonId: lesson!.id,
      lineageId: "vid",
      title: "v.mp4",
      originalFootagePath: "/f",
    })
    .returning();
  const [beat] = await testDb
    .insert(schema.beats)
    .values({
      videoId: video!.id,
      kind: "definition",
      title: "Explain",
      order: "a0",
    })
    .returning();
  const [clip] = await testDb
    .insert(schema.clips)
    .values({
      videoId: video!.id,
      videoFilename: "take.mp4",
      sourceStartTime: 0,
      sourceEndTime: 5,
      order: "a0",
      text: "",
    })
    .returning();
  return { version: v!, section: section!, beat: beat!, clip: clip! };
}

async function course() {
  const [c] = await testDb
    .insert(schema.courses)
    .values({ name: "Cohort" })
    .returning();
  return c!.id;
}

const goalsOf = (sectionId: string) =>
  testDb.query.learningGoals.findMany({
    where: (g, { eq }) => eq(g.sectionId, sectionId),
    with: { beatLearningGoals: true },
    orderBy: (g, { asc }) => asc(g.order),
  });

describe("runVersionChildrenRepair — Learning Goals", () => {
  it("restores the earlier Version's live goals and their Beat links onto the Draft", async () => {
    const courseId = await course();
    const v1 = await version(courseId, "published", "2026-01-01");
    const [goal] = await testDb
      .insert(schema.learningGoals)
      .values([
        { sectionId: v1.section.id, title: "Knows Beats", order: 1 },
        {
          sectionId: v1.section.id,
          title: "Deleted",
          order: 2,
          archived: true,
        },
      ])
      .returning();
    await testDb
      .insert(schema.beatLearningGoals)
      .values({ beatId: v1.beat.id, learningGoalId: goal!.id });
    const draft = await version(courseId, "draft", "2026-02-01");

    const dryRun = await runVersionChildrenRepair(db(), { apply: false });
    expect(dryRun.goals.map((g) => g.title)).toEqual(["Knows Beats"]);
    expect(await goalsOf(draft.section.id)).toEqual([]);

    await runVersionChildrenRepair(db(), { apply: true });

    const restored = await goalsOf(draft.section.id);
    expect(restored).toMatchObject([
      {
        title: "Knows Beats",
        order: 1,
        archived: false,
        beatLearningGoals: [{ beatId: draft.beat.id }],
      },
    ]);
    const draftRow = await testDb.query.courseVersions.findFirst({
      where: (v, { eq }) => eq(v.id, draft.version.id),
    });
    expect(draftRow!.hasChanges).toBe(true);

    // Only fills what is missing, so a second run finds nothing.
    const again = await runVersionChildrenRepair(db(), { apply: false });
    expect(again.versionIds).toEqual([]);
  });

  it("follows a Beat moved to another Video of the Section, by kind and title", async () => {
    const courseId = await course();
    const v1 = await version(courseId, "published", "2026-01-01");
    const [goal] = await testDb
      .insert(schema.learningGoals)
      .values({ sectionId: v1.section.id, title: "Goal", order: 1 })
      .returning();
    await testDb
      .insert(schema.beatLearningGoals)
      .values({ beatId: v1.beat.id, learningGoalId: goal!.id });
    const draft = await version(courseId, "draft", "2026-02-01");
    const [lesson] = await testDb
      .insert(schema.lessons)
      .values({ sectionId: draft.section.id, title: "L2", order: 2 })
      .returning();
    const [otherVideo] = await testDb
      .insert(schema.videos)
      .values({
        lessonId: lesson!.id,
        title: "w.mp4",
        originalFootagePath: "/w",
      })
      .returning();
    await testDb
      .update(schema.beats)
      .set({ videoId: otherVideo!.id })
      .where(eq(schema.beats.id, draft.beat.id));

    const plan = await runVersionChildrenRepair(db(), { apply: false });

    expect(plan.beatLinks.map((l) => l.beatId)).toEqual([draft.beat.id]);
    expect(plan.unmatchedBeatLinks).toEqual([]);
  });

  it("never resurrects a goal the Draft has archived, and reports it", async () => {
    const courseId = await course();
    const v1 = await version(courseId, "published", "2026-01-01");
    await testDb.insert(schema.learningGoals).values([
      { sectionId: v1.section.id, title: "Cut in the Draft", order: 1 },
      { sectionId: v1.section.id, title: "Still wanted", order: 2 },
    ]);
    const draft = await version(courseId, "draft", "2026-02-01");
    await testDb.insert(schema.learningGoals).values({
      sectionId: draft.section.id,
      title: "Cut in the Draft",
      order: 1,
      archived: true,
    });

    const plan = await runVersionChildrenRepair(db(), { apply: true });

    expect(plan.archivedInDraft.map((a) => a.goalTitle)).toEqual([
      "Cut in the Draft",
    ]);
    expect(
      (await goalsOf(draft.section.id)).map((g) => [g.title, g.archived])
    ).toEqual([
      ["Cut in the Draft", true],
      ["Still wanted", false],
    ]);
  });

  it("leaves a Draft goal with the same title alone and moves a clashing order past the end", async () => {
    const courseId = await course();
    const v1 = await version(courseId, "published", "2026-01-01");
    await testDb.insert(schema.learningGoals).values([
      { sectionId: v1.section.id, title: "Already here", order: 1 },
      { sectionId: v1.section.id, title: "Missing", order: 2 },
    ]);
    const draft = await version(courseId, "draft", "2026-02-01");
    await testDb.insert(schema.learningGoals).values([
      { sectionId: draft.section.id, title: "Already here", order: 1 },
      { sectionId: draft.section.id, title: "Written in the Draft", order: 2 },
    ]);

    await runVersionChildrenRepair(db(), { apply: true });

    expect(
      (await goalsOf(draft.section.id)).map((g) => [g.title, g.order])
    ).toEqual([
      ["Already here", 1],
      ["Written in the Draft", 2],
      ["Missing", 3],
    ]);
  });
});

describe("runVersionChildrenRepair — Clip Web Links and Transcript Words", () => {
  it("takes them from the most recent earlier copy of the Clip that had any", async () => {
    const courseId = await course();
    const v1 = await version(courseId, "published", "2026-01-01");
    await testDb.insert(schema.clipWebLinks).values({
      clipId: v1.clip.id,
      url: "https://old.example.com",
      capturedAt: new Date("2026-01-01T00:00:00Z"),
    });
    await testDb
      .insert(schema.clipTranscriptWords)
      .values({ clipId: v1.clip.id, start: 0.1, end: 0.3, text: "hi" });
    // v2 already lost them (the bug compounds), so v1 is the source.
    await version(courseId, "published", "2026-02-01");
    const draft = await version(courseId, "draft", "2026-03-01");

    await runVersionChildrenRepair(db(), { apply: true });

    const clip = await testDb.query.clips.findFirst({
      where: (c, { eq }) => eq(c.id, draft.clip.id),
      with: { webLinks: true, transcriptWords: true },
    });
    expect(clip!.webLinks).toMatchObject([
      {
        url: "https://old.example.com",
        capturedAt: new Date("2026-01-01T00:00:00Z"),
      },
    ]);
    expect(clip!.transcriptWords).toMatchObject([
      { start: 0.1, end: 0.3, text: "hi" },
    ]);
  });

  it("never touches a Draft Clip that already has its own", async () => {
    const courseId = await course();
    const v1 = await version(courseId, "published", "2026-01-01");
    await testDb
      .insert(schema.clipWebLinks)
      .values({ clipId: v1.clip.id, url: "https://old.example.com" });
    const draft = await version(courseId, "draft", "2026-02-01");
    await testDb
      .insert(schema.clipWebLinks)
      .values({ clipId: draft.clip.id, url: "https://new.example.com" });

    const plan = await runVersionChildrenRepair(db(), { apply: true });

    expect(plan.webLinks).toEqual([]);
    const links = await testDb.query.clipWebLinks.findMany({
      where: (l, { eq }) => eq(l.clipId, draft.clip.id),
    });
    expect(links.map((l) => l.url)).toEqual(["https://new.example.com"]);
  });
});
