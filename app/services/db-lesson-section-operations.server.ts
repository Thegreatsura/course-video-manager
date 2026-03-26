import type { DrizzleDB } from "@/services/drizzle-service.server";
import { lessons, sections, videos } from "@/db/schema";
import {
  NotFoundError,
  UnknownDBServiceError,
} from "@/services/db-service-errors";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { Effect } from "effect";

const makeDbCall = <T>(fn: () => Promise<T>) => {
  return Effect.tryPromise({
    try: fn,
    catch: (e) => new UnknownDBServiceError({ cause: e }),
  });
};

export const createLessonSectionOperations = (db: DrizzleDB) => {
  const getLessonById = Effect.fn("getLessonById")(function* (id: string) {
    const lesson = yield* makeDbCall(() =>
      db.query.lessons.findFirst({
        where: eq(lessons.id, id),
        with: {
          videos: {
            orderBy: asc(videos.path),
          },
        },
      })
    );

    if (!lesson) {
      return yield* new NotFoundError({
        type: "getLessonById",
        params: { id },
      });
    }

    return lesson;
  });

  const getLessonsBySectionId = Effect.fn("getLessonsBySectionId")(function* (
    sectionId: string
  ) {
    return yield* makeDbCall(() =>
      db.query.lessons.findMany({
        where: eq(lessons.sectionId, sectionId),
        orderBy: asc(lessons.order),
      })
    );
  });

  const getLessonWithHierarchyById = Effect.fn("getLessonWithHierarchyById")(
    function* (id: string) {
      const lesson = yield* makeDbCall(() =>
        db.query.lessons.findFirst({
          where: eq(lessons.id, id),
          with: {
            section: {
              with: {
                repoVersion: {
                  with: {
                    repo: true,
                  },
                },
              },
            },
          },
        })
      );

      if (!lesson) {
        return yield* new NotFoundError({
          type: "getLessonWithHierarchyById",
          params: { id },
        });
      }

      return lesson;
    }
  );

  const getSectionWithHierarchyById = Effect.fn("getSectionWithHierarchyById")(
    function* (id: string) {
      const section = yield* makeDbCall(() =>
        db.query.sections.findFirst({
          where: eq(sections.id, id),
          with: {
            repoVersion: {
              with: {
                repo: true,
              },
            },
          },
        })
      );

      if (!section) {
        return yield* new NotFoundError({
          type: "getSectionWithHierarchyById",
          params: { id },
        });
      }

      return section;
    }
  );

  const createSections = Effect.fn("createSections")(function* ({
    sections: newSections,
    repoVersionId,
  }: {
    sections: {
      sectionPathWithNumber: string;
      sectionNumber: number;
    }[];
    repoVersionId: string;
  }) {
    const sectionResult = yield* makeDbCall(() =>
      db
        .insert(sections)
        .values(
          newSections.map((section) => ({
            repoVersionId,
            path: section.sectionPathWithNumber,
            order: section.sectionNumber,
          }))
        )
        .returning()
    );

    return sectionResult;
  });

  const createLessons = Effect.fn("createLessons")(function* (
    sectionId: string,
    newLessons: {
      lessonPathWithNumber: string;
      lessonNumber: number;
    }[]
  ) {
    const lessonResult = yield* makeDbCall(() =>
      db
        .insert(lessons)
        .values(
          newLessons.map((lesson) => ({
            sectionId,
            path: lesson.lessonPathWithNumber,
            order: lesson.lessonNumber,
          }))
        )
        .returning()
    );

    return lessonResult;
  });

  const createGhostLesson = Effect.fn("createGhostLesson")(function* (
    sectionId: string,
    opts: {
      title: string;
      path: string;
      order: number;
    }
  ) {
    const lessonResult = yield* makeDbCall(() =>
      db
        .insert(lessons)
        .values({
          sectionId,
          title: opts.title,
          path: opts.path,
          order: opts.order,
          fsStatus: "ghost",
        })
        .returning()
    );

    return lessonResult;
  });

  const updateLesson = Effect.fn("updateLesson")(function* (
    lessonId: string,
    lesson: {
      path?: string;
      sectionId?: string;
      lessonNumber?: number;
      title?: string;
      fsStatus?: string;
      description?: string;
      dependencies?: string[];
      icon?: string | null;
      priority?: number;
    }
  ) {
    const lessonResult = yield* makeDbCall(() =>
      db
        .update(lessons)
        .set({
          path: lesson.path,
          sectionId: lesson.sectionId,
          order: lesson.lessonNumber,
          title: lesson.title,
          fsStatus: lesson.fsStatus,
          description: lesson.description,
          dependencies: lesson.dependencies,
          icon: lesson.icon,
          priority: lesson.priority,
        })
        .where(eq(lessons.id, lessonId))
    );

    return lessonResult;
  });

  const deleteLesson = Effect.fn("deleteLesson")(function* (lessonId: string) {
    const lessonResult = yield* makeDbCall(() =>
      db.delete(lessons).where(eq(lessons.id, lessonId))
    );

    return lessonResult;
  });

  const deleteSection = Effect.fn("deleteSection")(function* (
    sectionId: string
  ) {
    const sectionResult = yield* makeDbCall(() =>
      db.delete(sections).where(eq(sections.id, sectionId))
    );

    return sectionResult;
  });

  const archiveSection = Effect.fn("archiveSection")(function* (
    sectionId: string
  ) {
    return yield* makeDbCall(() =>
      db
        .update(sections)
        .set({ archivedAt: new Date() })
        .where(eq(sections.id, sectionId))
    );
  });

  const updateSectionOrder = Effect.fn("updateSectionOrder")(function* (
    sectionId: string,
    order: number
  ) {
    return yield* makeDbCall(() =>
      db.update(sections).set({ order }).where(eq(sections.id, sectionId))
    );
  });

  const updateSectionPath = Effect.fn("updateSectionPath")(function* (
    sectionId: string,
    path: string
  ) {
    return yield* makeDbCall(() =>
      db.update(sections).set({ path }).where(eq(sections.id, sectionId))
    );
  });

  const updateSectionDescription = Effect.fn("updateSectionDescription")(
    function* (sectionId: string, description: string) {
      return yield* makeDbCall(() =>
        db
          .update(sections)
          .set({ description })
          .where(eq(sections.id, sectionId))
      );
    }
  );

  const getSectionsByIds = Effect.fn("getSectionsByIds")(function* (
    ids: readonly string[]
  ) {
    if (ids.length === 0) return [];
    return yield* makeDbCall(() =>
      db.query.sections.findMany({
        where: inArray(sections.id, ids as string[]),
      })
    );
  });

  const getSectionsByRepoVersionId = Effect.fn("getSectionsByRepoVersionId")(
    function* (repoVersionId: string) {
      return yield* makeDbCall(() =>
        db.query.sections.findMany({
          where: and(
            eq(sections.repoVersionId, repoVersionId),
            isNull(sections.archivedAt)
          ),
          orderBy: asc(sections.order),
        })
      );
    }
  );

  const updateLessonOrder = Effect.fn("updateLessonOrder")(function* (
    lessonId: string,
    order: number
  ) {
    return yield* makeDbCall(() =>
      db.update(lessons).set({ order }).where(eq(lessons.id, lessonId))
    );
  });

  return {
    getLessonById,
    getLessonsBySectionId,
    getLessonWithHierarchyById,
    getSectionWithHierarchyById,
    createSections,
    createLessons,
    createGhostLesson,
    updateLesson,
    deleteLesson,
    deleteSection,
    archiveSection,
    updateSectionOrder,
    updateSectionPath,
    updateSectionDescription,
    getSectionsByIds,
    getSectionsByRepoVersionId,
    updateLessonOrder,
  };
};
