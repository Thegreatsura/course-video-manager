import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  beatLearningGoals,
  beats,
  clipTranscriptWords,
  clipWebLinks,
  clips,
  courseVersions,
  learningGoals,
  lessons,
  sections,
  videos,
} from "../db/schema.js";
import type { Database } from "./drizzle-service.server.js";
import { insertInChunks } from "./copy-child-rows.js";
import {
  planVersionChildrenRepair,
  type RepairInput,
  type RepairPlan,
} from "./version-children-repair.js";

export {
  planVersionChildrenRepair,
  type RepairPlan,
} from "./version-children-repair.js";

const versioned = {
  courseId: courseVersions.repoId,
  versionId: courseVersions.id,
  commitState: courseVersions.commitState,
  versionCreatedAt: courseVersions.createdAt,
};

/** Everything the plan reads: live structure in every Version of every Course. */
export const loadVersionChildrenRepairInput = async (
  db: Pick<Database, "select">
): Promise<RepairInput> => {
  const liveSection = isNull(sections.archivedAt);
  const sectionRows = await db
    .select({ id: sections.id, lineageId: sections.lineageId, ...versioned })
    .from(sections)
    .innerJoin(courseVersions, eq(courseVersions.id, sections.repoVersionId))
    .where(liveSection);
  const goals = await db
    .select({
      id: learningGoals.id,
      sectionId: learningGoals.sectionId,
      title: learningGoals.title,
      description: learningGoals.description,
      priority: learningGoals.priority,
      order: learningGoals.order,
      archived: learningGoals.archived,
    })
    .from(learningGoals)
    .innerJoin(sections, eq(sections.id, learningGoals.sectionId))
    .where(liveSection);

  const liveTree = and(
    eq(videos.archived, false),
    eq(lessons.archived, false),
    liveSection
  );
  const beatRows = await db
    .select({
      id: beats.id,
      versionId: sections.repoVersionId,
      sectionId: sections.id,
      videoLineageId: videos.lineageId,
      kind: beats.kind,
      title: beats.title,
    })
    .from(beats)
    .innerJoin(videos, eq(videos.id, beats.videoId))
    .innerJoin(lessons, eq(lessons.id, videos.lessonId))
    .innerJoin(sections, eq(sections.id, lessons.sectionId))
    .where(and(eq(beats.archived, false), liveTree));
  const clipRows = await db
    .select({
      id: clips.id,
      videoLineageId: videos.lineageId,
      videoFilename: clips.videoFilename,
      sourceStartTime: clips.sourceStartTime,
      sourceEndTime: clips.sourceEndTime,
      ...versioned,
    })
    .from(clips)
    .innerJoin(videos, eq(videos.id, clips.videoId))
    .innerJoin(lessons, eq(lessons.id, videos.lessonId))
    .innerJoin(sections, eq(sections.id, lessons.sectionId))
    .innerJoin(courseVersions, eq(courseVersions.id, sections.repoVersionId))
    .where(and(eq(clips.archived, false), liveTree));

  return {
    sections: sectionRows,
    goals,
    beats: beatRows,
    beatLinks: await db.select().from(beatLearningGoals),
    clips: clipRows,
    webLinks: await db
      .select({
        clipId: clipWebLinks.clipId,
        url: clipWebLinks.url,
        title: clipWebLinks.title,
        capturedAt: clipWebLinks.capturedAt,
      })
      .from(clipWebLinks),
    words: await db
      .select({
        clipId: clipTranscriptWords.clipId,
        start: clipTranscriptWords.start,
        end: clipTranscriptWords.end,
        text: clipTranscriptWords.text,
      })
      .from(clipTranscriptWords),
  };
};

/**
 * Plans and, with `apply`, writes — in ONE transaction that first locks every
 * Draft row, so the plan is made against exactly what it writes to and no
 * Submit can turn a target into a Pending Version underneath it. Refuses
 * outright if any target is not a Draft. Marks every touched Draft
 * `hasChanges`: the restored rows are a difference that needs a Publish.
 */
export const runVersionChildrenRepair = async (
  db: Database,
  opts: { apply: boolean }
): Promise<RepairPlan> => {
  if (!opts.apply) {
    return planVersionChildrenRepair(await loadVersionChildrenRepairInput(db));
  }
  return db.transaction(async (tx) => {
    const lockedDrafts = await tx
      .select({
        id: courseVersions.id,
        commitState: courseVersions.commitState,
      })
      .from(courseVersions)
      .where(eq(courseVersions.commitState, "draft"))
      .for("update");
    const drafts = new Set(lockedDrafts.map((v) => v.id));
    const plan = planVersionChildrenRepair(
      await loadVersionChildrenRepairInput(tx)
    );
    const stale = plan.versionIds.find((id) => !drafts.has(id));
    if (stale) {
      throw new Error(`Version ${stale} is not a Draft — refusing to write.`);
    }

    await insertInChunks(
      tx,
      learningGoals,
      plan.goals.map(
        ({ courseId: _c, versionId: _v, fromVersionId: _f, ...goal }) => goal
      )
    );
    await insertInChunks(
      tx,
      beatLearningGoals,
      plan.beatLinks.map(({ beatId, learningGoalId }) => ({
        beatId,
        learningGoalId,
      }))
    );
    await insertInChunks(
      tx,
      clipWebLinks,
      plan.webLinks.map(({ courseId: _c, versionId: _v, ...link }) => link)
    );
    await insertInChunks(
      tx,
      clipTranscriptWords,
      plan.words.map(({ courseId: _c, versionId: _v, ...word }) => word)
    );
    if (plan.versionIds.length > 0) {
      await tx
        .update(courseVersions)
        .set({ hasChanges: true })
        .where(inArray(courseVersions.id, plan.versionIds));
    }
    return plan;
  });
};
