import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  clips,
  courseVersions,
  courses,
  lessons,
  sections,
  videos,
} from "../db/schema.js";
import type { Database } from "./drizzle-service.server.js";

/**
 * One-off repair for the Submit copy bug: until the fix that ships with this
 * file, cloning a Draft (Submit) dropped every Clip's `zoomType` and
 * `diagramSnapshotId`, so each new Draft started with every Clip unzoomed and
 * unpinned — and the loss compounded with every Submit after it.
 *
 * Clips carry no lineage id, so a Draft Clip is matched to its earlier copies
 * by (Video lineageId, videoFilename, sourceStartTime, sourceEndTime) within
 * the same Course. A Draft Clip still at the default (`none` / unpinned) takes
 * the value from the most recent earlier Version that had one set. A Draft
 * Clip that already has a value is never touched.
 *
 * Caveat: a zoom or pin Matt deliberately cleared on a later Draft is
 * indistinguishable from one the copy dropped, so it would be restored too.
 */

export type ClipCarryRow = {
  clipId: string;
  courseId: string;
  versionId: string;
  commitState: string;
  versionCreatedAt: Date;
  videoLineageId: string;
  videoFilename: string;
  sourceStartTime: number;
  sourceEndTime: number;
  zoomType: string;
  diagramSnapshotId: string | null;
};

export type ClipCarryFix = {
  clipId: string;
  courseId: string;
  versionId: string;
  zoomType?: string;
  diagramSnapshotId?: string;
};

const matchKey = (row: ClipCarryRow) =>
  [
    row.courseId,
    row.videoLineageId,
    row.videoFilename,
    row.sourceStartTime,
    row.sourceEndTime,
  ].join("\u0000");

/** Pure: which Draft Clips get which value back. */
export const planClipCarryRepair = (rows: ClipCarryRow[]): ClipCarryFix[] => {
  const earlierByKey = new Map<string, ClipCarryRow[]>();
  for (const row of rows) {
    if (row.commitState === "draft") continue;
    const key = matchKey(row);
    const list = earlierByKey.get(key) ?? [];
    list.push(row);
    earlierByKey.set(key, list);
  }
  for (const list of earlierByKey.values()) {
    list.sort(
      (a, b) => b.versionCreatedAt.getTime() - a.versionCreatedAt.getTime()
    );
  }

  const fixes: ClipCarryFix[] = [];
  for (const draft of rows) {
    if (draft.commitState !== "draft") continue;
    const earlier = (earlierByKey.get(matchKey(draft)) ?? []).filter(
      (row) => row.versionCreatedAt < draft.versionCreatedAt
    );
    const fix: ClipCarryFix = {
      clipId: draft.clipId,
      courseId: draft.courseId,
      versionId: draft.versionId,
    };
    if (draft.zoomType === "none") {
      const zoomType = earlier.find((row) => row.zoomType !== "none")?.zoomType;
      if (zoomType) fix.zoomType = zoomType;
    }
    if (draft.diagramSnapshotId === null) {
      const pinned = earlier.find((row) => row.diagramSnapshotId !== null);
      if (pinned) fix.diagramSnapshotId = pinned.diagramSnapshotId!;
    }
    if (fix.zoomType || fix.diagramSnapshotId) fixes.push(fix);
  }
  return fixes;
};

/** Every live Clip in every Version of every Course, flattened for the plan. */
export const loadClipCarryRows = async (
  db: Database
): Promise<ClipCarryRow[]> =>
  db
    .select({
      clipId: clips.id,
      courseId: courseVersions.repoId,
      versionId: courseVersions.id,
      commitState: courseVersions.commitState,
      versionCreatedAt: courseVersions.createdAt,
      videoLineageId: videos.lineageId,
      videoFilename: clips.videoFilename,
      sourceStartTime: clips.sourceStartTime,
      sourceEndTime: clips.sourceEndTime,
      zoomType: clips.zoomType,
      diagramSnapshotId: clips.diagramSnapshotId,
    })
    .from(clips)
    .innerJoin(videos, eq(videos.id, clips.videoId))
    .innerJoin(lessons, eq(lessons.id, videos.lessonId))
    .innerJoin(sections, eq(sections.id, lessons.sectionId))
    .innerJoin(courseVersions, eq(courseVersions.id, sections.repoVersionId))
    .where(
      and(
        eq(clips.archived, false),
        eq(videos.archived, false),
        eq(lessons.archived, false),
        isNull(sections.archivedAt)
      )
    );

export const courseNames = async (db: Database, ids: string[]) =>
  ids.length === 0
    ? new Map<string, string>()
    : new Map(
        (
          await db
            .select({ id: courses.id, name: courses.name })
            .from(courses)
            .where(inArray(courses.id, ids))
        ).map((c) => [c.id, c.name])
      );

/**
 * Writes the plan in one transaction. Only ever touches Clips on a Version that
 * is still a Draft, and marks each such Draft `hasChanges` — a restored zoom or
 * pin is a difference from the last Published Version, so it needs a Publish.
 */
export const applyClipCarryRepair = async (
  db: Database,
  fixes: ClipCarryFix[]
) =>
  db.transaction(async (tx) => {
    const stillDraft = new Set(
      (
        await tx
          .select({ id: courseVersions.id })
          .from(courseVersions)
          .where(eq(courseVersions.commitState, "draft"))
          .for("update")
      ).map((v) => v.id)
    );
    const stale = fixes.find((fix) => !stillDraft.has(fix.versionId));
    if (stale) {
      throw new Error(
        `Version ${stale.versionId} is no longer a Draft — re-run the dry run.`
      );
    }
    for (const fix of fixes) {
      await tx
        .update(clips)
        .set({
          ...(fix.zoomType ? { zoomType: fix.zoomType } : {}),
          ...(fix.diagramSnapshotId
            ? { diagramSnapshotId: fix.diagramSnapshotId }
            : {}),
        })
        .where(eq(clips.id, fix.clipId));
    }
    const versionIds = [...new Set(fixes.map((fix) => fix.versionId))];
    if (versionIds.length > 0) {
      await tx
        .update(courseVersions)
        .set({ hasChanges: true })
        .where(inArray(courseVersions.id, versionIds));
    }
  });
