import { type Database } from "./drizzle-service.server.js";
import { courseVersions, lessons, sections } from "../db/schema.js";
import { UnknownDBServiceError } from "./db-service-errors.js";
import { and, eq } from "drizzle-orm";
import { Effect } from "effect";

const makeDbCall = <T>(fn: () => Promise<T>) =>
  Effect.tryPromise({
    try: fn,
    catch: (cause) => new UnknownDBServiceError({ cause }),
  });

/** The version-scoped nouns that record a `previousVersion…Id` link. */
export type SuccessorEntity = "section" | "lesson";

/** Where an id from an earlier Course Version lives on in a later one. */
export interface VersionSuccessor {
  readonly id: string;
  readonly versionId: string;
  readonly commitState: string;
  readonly archived: boolean;
}

/**
 * A chain longer than this is a cycle or corrupt data, not a real history:
 * each link is one Submit.
 */
const MAX_LINKS = 100;

/**
 * Follow a Section or Lesson id forward through later Course Versions to its
 * equivalent in the Draft, for an id that no longer resolves.
 *
 * Submit copies the Draft into a fresh Draft, and each copied row records the
 * row it came from (`previousVersionSectionId` / `previousVersionLessonId`).
 * A Discarded Pending Version is deleted, so the ids an agent read before the
 * Submit can vanish while the content lives on in the new Draft — the
 * previous-version link is the only thing left that remembers them.
 *
 * The walk goes forward link by link. If it stops on a row that is not in the
 * Draft (a later link pointed at a version that has since been deleted), the
 * row's `lineageId` — which every version copy carries unchanged — finds the
 * Draft's copy instead. Returns the furthest row reached, or null when nothing
 * ever came from `id`. Split out of db-version-operations.server.ts for the
 * per-file token budget, like its siblings.
 */
export const createVersionSuccessorOps = (db: Database) => {
  /** A section row speaks of `archivedAt`; a lesson row of `archived`. */
  const sectionLink = <T extends { archivedAt: Date | null }>({
    archivedAt,
    ...rest
  }: T) => ({ ...rest, archived: archivedAt !== null });

  const nextSection = (id: string) =>
    makeDbCall(() =>
      db
        .select({
          id: sections.id,
          lineageId: sections.lineageId,
          versionId: sections.repoVersionId,
          repoId: courseVersions.repoId,
          commitState: courseVersions.commitState,
          archivedAt: sections.archivedAt,
        })
        .from(sections)
        .innerJoin(
          courseVersions,
          eq(sections.repoVersionId, courseVersions.id)
        )
        .where(eq(sections.previousVersionSectionId, id))
        .limit(1)
    ).pipe(Effect.map(([row]) => (row ? sectionLink(row) : undefined)));

  const nextLesson = (id: string) =>
    makeDbCall(() =>
      db
        .select({
          id: lessons.id,
          lineageId: lessons.lineageId,
          versionId: sections.repoVersionId,
          repoId: courseVersions.repoId,
          commitState: courseVersions.commitState,
          archived: lessons.archived,
        })
        .from(lessons)
        .innerJoin(sections, eq(lessons.sectionId, sections.id))
        .innerJoin(
          courseVersions,
          eq(sections.repoVersionId, courseVersions.id)
        )
        .where(eq(lessons.previousVersionLessonId, id))
        .limit(1)
    ).pipe(Effect.map(([row]) => row));

  /** The Draft's copy of `lineageId` within the course, if it has one. */
  const draftByLineage = (
    entity: SuccessorEntity,
    repoId: string,
    lineageId: string
  ) =>
    entity === "section"
      ? makeDbCall(() =>
          db
            .select({
              id: sections.id,
              versionId: sections.repoVersionId,
              commitState: courseVersions.commitState,
              archivedAt: sections.archivedAt,
            })
            .from(sections)
            .innerJoin(
              courseVersions,
              eq(sections.repoVersionId, courseVersions.id)
            )
            .where(
              and(
                eq(courseVersions.repoId, repoId),
                eq(courseVersions.commitState, "draft"),
                eq(sections.lineageId, lineageId)
              )
            )
            .limit(1)
        ).pipe(Effect.map(([row]) => (row ? sectionLink(row) : undefined)))
      : makeDbCall(() =>
          db
            .select({
              id: lessons.id,
              versionId: sections.repoVersionId,
              commitState: courseVersions.commitState,
              archived: lessons.archived,
            })
            .from(lessons)
            .innerJoin(sections, eq(lessons.sectionId, sections.id))
            .innerJoin(
              courseVersions,
              eq(sections.repoVersionId, courseVersions.id)
            )
            .where(
              and(
                eq(courseVersions.repoId, repoId),
                eq(courseVersions.commitState, "draft"),
                eq(lessons.lineageId, lineageId)
              )
            )
            .limit(1)
        ).pipe(Effect.map(([row]) => row));

  const findVersionSuccessor = Effect.fn("findVersionSuccessor")(function* (
    entity: SuccessorEntity,
    id: string
  ) {
    let reached: Effect.Effect.Success<ReturnType<typeof nextLesson>> =
      undefined;
    let cursor = id;
    for (let i = 0; i < MAX_LINKS; i++) {
      const row =
        entity === "section"
          ? yield* nextSection(cursor)
          : yield* nextLesson(cursor);
      if (row === undefined) break;
      reached = row;
      if (row.commitState === "draft") break;
      cursor = row.id;
    }
    if (reached === undefined) return null;

    if (reached.commitState !== "draft") {
      const draft = yield* draftByLineage(
        entity,
        reached.repoId,
        reached.lineageId
      );
      if (draft !== undefined) reached = { ...reached, ...draft };
    }

    const successor: VersionSuccessor = {
      id: reached.id,
      versionId: reached.versionId,
      commitState: reached.commitState,
      archived: reached.archived,
    };
    return successor;
  });

  return { findVersionSuccessor };
};
