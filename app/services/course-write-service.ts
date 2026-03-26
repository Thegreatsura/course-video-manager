import { Effect } from "effect";
import { FileSystem } from "@effect/platform";
import { NodeFileSystem } from "@effect/platform-node";
import { DBFunctionsService } from "./db-service.server";
import { CourseRepoWriteService } from "./course-repo-write-service";
import {
  toSlug,
  computeRenumberingPlan,
  parseLessonPath,
  buildLessonPath,
} from "./lesson-path-service";
import { parseSectionPath, titleFromSlug } from "./section-path-service";
import { createSectionOps } from "./course-write-service.helpers";
import { createMaterializeOps } from "./course-write-materialize-ops";
import { CourseWriteError } from "./course-write-service.types";
import {
  CourseRepoSyncValidationService,
  CourseRepoSyncError,
} from "./course-repo-sync-validation";

export { CourseWriteError } from "./course-write-service.types";
export { CourseRepoSyncError } from "./course-repo-sync-validation";

export class CourseWriteService extends Effect.Service<CourseWriteService>()(
  "CourseWriteService",
  {
    effect: Effect.gen(function* () {
      const db = yield* DBFunctionsService;
      const repoWrite = yield* CourseRepoWriteService;
      const syncService = yield* CourseRepoSyncValidationService;
      const fileSystem = yield* FileSystem.FileSystem;

      const runValidation = syncService.validate().pipe(
        Effect.catchAll((e) => {
          if (e._tag === "CourseRepoSyncError") return Effect.fail(e);
          return Effect.fail(
            new CourseRepoSyncError({
              cause: e,
              message: `Sync validation encountered an error: ${String(e)}`,
            })
          );
        })
      );

      /**
       * Runs sync validation AFTER the operation completes.
       * Pre-validation was removed because it doubled filesystem I/O
       * for every request — extremely slow on WSL 2 where each fs call
       * crosses the Linux/Windows bridge (~100ms+ per call).
       */
      const withPostValidation = <A, E>(
        effect: Effect.Effect<A, E>
      ): Effect.Effect<A, E | CourseRepoSyncError> =>
        Effect.gen(function* () {
          const result = yield* effect;
          yield* runValidation;
          return result;
        });

      const { renumberSections, reorderSections, renameSection } =
        createSectionOps(db, repoWrite);

      /** Creates a ghost section in the database (no filesystem operations). */
      const addGhostSection = Effect.fn("addGhostSection")(function* (
        repoVersionId: string,
        title: string,
        maxOrder: number = 0
      ) {
        const sectionNumber = maxOrder + 1;
        const [newSection] = yield* db.createSections({
          repoVersionId,
          sections: [
            {
              sectionPathWithNumber: title,
              sectionNumber,
            },
          ],
        });

        return { success: true, sectionId: newSection!.id };
      });

      const {
        createRealLesson,
        materializeGhost,
        materializeCourseWithLesson,
      } = createMaterializeOps(db, repoWrite, fileSystem, renumberSections);

      /** Creates a ghost lesson. Supports optional insertion before/after a lesson. */
      const addGhostLesson = Effect.fn("addGhostLesson")(function* (
        sectionId: string,
        title: string,
        opts?: { adjacentLessonId?: string; position?: "before" | "after" }
      ) {
        const lessons = yield* db.getLessonsBySectionId(sectionId);
        const maxOrder =
          lessons.length > 0 ? Math.max(...lessons.map((l) => l.order)) : 0;
        let insertOrder = maxOrder + 1;

        if (opts?.adjacentLessonId && opts?.position) {
          const adjIdx = lessons.findIndex(
            (l) => l.id === opts.adjacentLessonId
          );
          if (adjIdx !== -1) {
            const idx = opts.position === "after" ? adjIdx + 1 : adjIdx;
            for (let i = idx; i < lessons.length; i++) {
              yield* db.updateLessonOrder(
                lessons[i]!.id,
                lessons[i]!.order + 1
              );
            }
            insertOrder = lessons[idx] ? lessons[idx]!.order : maxOrder + 1;
          }
        }

        const [newLesson] = yield* db.createGhostLesson(sectionId, {
          title,
          path: toSlug(title) || "untitled",
          order: insertOrder,
        });
        return { success: true, lessonId: newLesson!.id };
      });

      /** Deletes a lesson. If real, removes the directory from disk first,
       *  renumbers remaining lessons, and reverts section if no real lessons remain. */
      const deleteLesson = Effect.fn("deleteLesson")(function* (
        lessonId: string
      ) {
        const lesson = yield* db.getLessonWithHierarchyById(lessonId);

        if (lesson.fsStatus !== "ghost") {
          const repoPath = lesson.section.repoVersion.repo.filePath!;
          const sectionPath = lesson.section.path;
          const parsed = parseSectionPath(sectionPath);
          const sectionNumber = parsed?.sectionNumber ?? 1;

          yield* repoWrite.deleteLesson({
            repoPath,
            sectionPath,
            lessonDirName: lesson.path,
          });

          // Delete DB entry before renumbering so it's excluded
          yield* db.deleteLesson(lessonId);

          // Renumber remaining real lessons to close the gap
          const sectionLessons = yield* db.getLessonsBySectionId(
            lesson.sectionId
          );
          const remainingReal = sectionLessons.filter(
            (l) => l.fsStatus !== "ghost"
          );

          if (remainingReal.length > 0) {
            const renames: { id: string; oldPath: string; newPath: string }[] =
              [];
            for (let i = 0; i < remainingReal.length; i++) {
              const l = remainingReal[i]!;
              const p = parseLessonPath(l.path);
              if (!p) continue;
              const newPath = buildLessonPath(sectionNumber, i + 1, p.slug);
              if (newPath !== l.path) {
                renames.push({ id: l.id, oldPath: l.path, newPath });
              }
            }

            if (renames.length > 0) {
              yield* repoWrite.renameLessons({
                repoPath,
                sectionPath,
                renames: renames.map((r) => ({
                  oldPath: r.oldPath,
                  newPath: r.newPath,
                })),
              });

              for (const rename of renames) {
                yield* db.updateLesson(rename.id, {
                  path: rename.newPath,
                });
              }
            }
          }

          // If no real lessons remain, remove the section directory,
          // revert the section path to title case, and renumber other sections
          if (remainingReal.length === 0) {
            const sectionParsed = parseSectionPath(sectionPath);
            if (sectionParsed) {
              yield* repoWrite.deleteSectionDir({ repoPath, sectionPath });
              const title = titleFromSlug(sectionParsed.slug);
              yield* db.updateSectionPath(lesson.sectionId, title);
              yield* renumberSections(lesson.section.repoVersionId, repoPath);
            }
          }
          yield* runValidation;
        } else {
          // Ghost lesson: DB-only delete, skip filesystem validation
          yield* db.deleteLesson(lessonId);
        }

        return { success: true };
      });

      /** Converts a real lesson to a ghost. */
      const convertToGhost = Effect.fn("convertToGhost")(function* (
        lessonId: string
      ) {
        const lesson = yield* db.getLessonWithHierarchyById(lessonId);

        if (lesson.fsStatus !== "real") {
          return yield* new CourseWriteError({
            cause: null,
            message: "Lesson is already a ghost",
          });
        }

        const repoPath = lesson.section.repoVersion.repo.filePath!;
        const sectionPath = lesson.section.path;
        const parsed = parseSectionPath(sectionPath);
        const sectionNumber = parsed?.sectionNumber ?? 1;

        // Delete the lesson directory from disk
        yield* repoWrite.deleteLesson({
          repoPath,
          sectionPath,
          lessonDirName: lesson.path,
        });

        // Mark lesson as ghost in DB
        yield* db.updateLesson(lessonId, {
          fsStatus: "ghost",
        });

        // Renumber remaining real lessons to close the gap
        const sectionLessons = yield* db.getLessonsBySectionId(
          lesson.sectionId
        );
        const remainingReal = sectionLessons.filter(
          (l) => l.fsStatus !== "ghost" && l.id !== lessonId
        );

        if (remainingReal.length > 0) {
          const renames: { id: string; oldPath: string; newPath: string }[] =
            [];
          for (let i = 0; i < remainingReal.length; i++) {
            const l = remainingReal[i]!;
            const p = parseLessonPath(l.path);
            if (!p) continue;
            const newPath = buildLessonPath(sectionNumber, i + 1, p.slug);
            if (newPath !== l.path) {
              renames.push({ id: l.id, oldPath: l.path, newPath });
            }
          }

          if (renames.length > 0) {
            yield* repoWrite.renameLessons({
              repoPath,
              sectionPath,
              renames: renames.map((r) => ({
                oldPath: r.oldPath,
                newPath: r.newPath,
              })),
            });

            for (const rename of renames) {
              yield* db.updateLesson(rename.id, {
                path: rename.newPath,
              });
            }
          }
        }

        // If no real lessons remain, remove the section directory,
        // revert the section path to title case, and renumber other sections
        if (remainingReal.length === 0) {
          const sectionParsed = parseSectionPath(sectionPath);
          if (sectionParsed) {
            yield* repoWrite.deleteSectionDir({ repoPath, sectionPath });
            const title = titleFromSlug(sectionParsed.slug);
            yield* db.updateSectionPath(lesson.sectionId, title);
            yield* renumberSections(lesson.section.repoVersionId, repoPath);
          }
        }

        return { success: true };
      });

      /** Renames a lesson's slug (preserves lesson number). */
      const renameLesson = Effect.fn("renameLesson")(function* (
        lessonId: string,
        newSlug: string
      ) {
        const lesson = yield* db.getLessonWithHierarchyById(lessonId);

        const oldParsed = parseLessonPath(lesson.path);

        // Ghost lesson with unparseable path — just update the slug in DB
        if (!oldParsed) {
          if (lesson.path === newSlug) {
            return { success: true, path: lesson.path };
          }
          yield* db.updateLesson(lessonId, { path: newSlug });
          return { success: true, path: newSlug };
        }

        if (oldParsed.slug === newSlug) {
          return { success: true, path: lesson.path };
        }

        const sectionNumber =
          oldParsed.sectionNumber ??
          parseSectionPath(lesson.section.path)?.sectionNumber ??
          1;
        const newPath = buildLessonPath(
          sectionNumber,
          oldParsed.lessonNumber,
          newSlug
        );

        if (lesson.fsStatus !== "ghost") {
          const repoPath = lesson.section.repoVersion.repo.filePath!;
          const sectionPath = lesson.section.path;

          yield* repoWrite.renameLesson({
            repoPath,
            sectionPath,
            oldLessonDirName: lesson.path,
            newSlug,
          });
        }

        yield* db.updateLesson(lessonId, {
          path: newPath,
        });

        // Only validate after filesystem-modifying renames
        if (lesson.fsStatus !== "ghost") {
          yield* runValidation;
        }

        return { success: true, path: newPath };
      });

      /** Reorders lessons within a section. */
      const reorderLessons = Effect.fn("reorderLessons")(function* (
        sectionId: string,
        newOrderIds: readonly string[]
      ) {
        const section = yield* db.getSectionWithHierarchyById(sectionId);
        const repoPath = section.repoVersion.repo.filePath!;
        const sectionPath = section.path;

        const sectionLessons = yield* db.getLessonsBySectionId(sectionId);

        // Only real lessons participate in filesystem renaming
        const realLessons = sectionLessons.filter(
          (l) => l.fsStatus !== "ghost"
        );
        const realLessonIds = newOrderIds.filter((id) =>
          realLessons.some((l) => l.id === id)
        );
        const lessonsForReorder = realLessons.map((l) => ({
          id: l.id,
          path: l.path,
        }));
        const renames = computeRenumberingPlan(
          lessonsForReorder,
          realLessonIds
        );

        if (renames.length > 0) {
          yield* repoWrite.renameLessons({
            repoPath,
            sectionPath,
            renames: renames.map((r) => ({
              oldPath: r.oldPath,
              newPath: r.newPath,
            })),
          });

          for (const rename of renames) {
            const parsed = parseLessonPath(rename.newPath);
            if (parsed) {
              yield* db.updateLesson(rename.id, {
                path: rename.newPath,
                lessonNumber: parsed.lessonNumber,
              });
            }
          }
        }

        // Update order for ALL lessons (ghost + real) based on position
        for (let i = 0; i < newOrderIds.length; i++) {
          yield* db.updateLessonOrder(newOrderIds[i]!, i);
        }

        return { success: true, renames };
      });

      /** Moves a lesson to a different section. */
      const moveToSection = Effect.fn("moveToSection")(function* (
        lessonId: string,
        targetSectionId: string
      ) {
        const lesson = yield* db.getLessonWithHierarchyById(lessonId);
        const targetLessons = yield* db.getLessonsBySectionId(targetSectionId);
        const maxOrder =
          targetLessons.length > 0
            ? Math.max(...targetLessons.map((l) => l.order))
            : 0;

        // Ghost lesson: DB-only move — skip filesystem validation entirely
        if (lesson.fsStatus === "ghost") {
          yield* db.updateLesson(lessonId, { sectionId: targetSectionId });
          yield* db.updateLessonOrder(lessonId, maxOrder + 1);
          return { success: true };
        }

        // Real lesson: filesystem move + renumber both sections
        const repoPath = lesson.section.repoVersion.repo.filePath!;
        const sourceSectionPath = lesson.section.path;
        const repoVersionId = lesson.section.repoVersionId;
        const targetSection =
          yield* db.getSectionWithHierarchyById(targetSectionId);
        let targetSectionPath = targetSection.path;

        const sourceParsed = parseSectionPath(sourceSectionPath);
        const sourceSectionNumber = sourceParsed?.sectionNumber ?? 1;

        // If target section is ghost, materialize it
        let targetParsed = parseSectionPath(targetSectionPath);
        let targetSectionMaterialized = false;
        if (!targetParsed) {
          const allSections =
            yield* db.getSectionsByRepoVersionId(repoVersionId);
          const posIdx = allSections.findIndex((s) => s.id === targetSectionId);
          let realBefore = 0;
          for (let i = 0; i < posIdx; i++) {
            if (parseSectionPath(allSections[i]!.path)) realBefore++;
          }
          const sectionNumber = realBefore + 1;
          const sectionSlug = toSlug(targetSectionPath) || "untitled";
          targetSectionPath = `${String(sectionNumber).padStart(2, "0")}-${sectionSlug}`;
          yield* db.updateSectionPath(targetSectionId, targetSectionPath);
          targetParsed = parseSectionPath(targetSectionPath);
          targetSectionMaterialized = true;
        }
        const targetSectionNumber = targetParsed?.sectionNumber ?? 1;

        // Compute new path in target section
        const lessonParsed = parseLessonPath(lesson.path);
        const slug = lessonParsed?.slug ?? lesson.path;
        const targetRealLessons = targetLessons.filter(
          (l) => l.fsStatus !== "ghost"
        );
        const nextLessonNumber = targetRealLessons.length + 1;
        const newLessonPath = buildLessonPath(
          targetSectionNumber,
          nextLessonNumber,
          slug
        );

        // Move the directory via git mv
        yield* repoWrite.moveLessonToSection({
          repoPath,
          sourceSectionPath,
          targetSectionPath,
          oldLessonDirName: lesson.path,
          newLessonDirName: newLessonPath,
        });

        // Update DB: move to target section with new path
        yield* db.updateLesson(lessonId, {
          sectionId: targetSectionId,
          path: newLessonPath,
        });
        yield* db.updateLessonOrder(lessonId, maxOrder + 1);

        // Renumber source section real lessons to close the gap
        const sourceLessons = yield* db.getLessonsBySectionId(lesson.sectionId);
        const sourceRealLessons = sourceLessons.filter(
          (l) => l.fsStatus !== "ghost" && l.id !== lessonId
        );

        if (sourceRealLessons.length > 0) {
          const renames: { id: string; oldPath: string; newPath: string }[] =
            [];
          for (let i = 0; i < sourceRealLessons.length; i++) {
            const l = sourceRealLessons[i]!;
            const p = parseLessonPath(l.path);
            if (!p) continue;
            const newPath = buildLessonPath(sourceSectionNumber, i + 1, p.slug);
            if (newPath !== l.path) {
              renames.push({ id: l.id, oldPath: l.path, newPath });
            }
          }

          if (renames.length > 0) {
            yield* repoWrite.renameLessons({
              repoPath,
              sectionPath: sourceSectionPath,
              renames: renames.map((r) => ({
                oldPath: r.oldPath,
                newPath: r.newPath,
              })),
            });

            for (const rename of renames) {
              yield* db.updateLesson(rename.id, { path: rename.newPath });
            }
          }
        }

        // If no real lessons remain in source, revert it to ghost
        if (sourceRealLessons.length === 0 && sourceParsed) {
          yield* repoWrite.deleteSectionDir({
            repoPath,
            sectionPath: sourceSectionPath,
          });
          const title = titleFromSlug(sourceParsed.slug);
          yield* db.updateSectionPath(lesson.sectionId, title);
        }

        // Renumber sections if any were materialized or dematerialized
        if (
          targetSectionMaterialized ||
          (sourceRealLessons.length === 0 && sourceParsed)
        ) {
          yield* renumberSections(repoVersionId, repoPath);
        }

        yield* runValidation;
        return { success: true };
      });

      /** Archives a section (soft-delete). Only works if there are no real lessons. */
      const archiveSection = Effect.fn("archiveSection")(function* (
        sectionId: string
      ) {
        const sectionLessons = yield* db.getLessonsBySectionId(sectionId);
        const realLessons = sectionLessons.filter(
          (l) => l.fsStatus !== "ghost"
        );

        if (realLessons.length > 0) {
          return yield* new CourseWriteError({
            cause: null,
            message:
              "Cannot archive section with real lessons. Convert or delete them first.",
          });
        }

        yield* db.archiveSection(sectionId);
        return { success: true };
      });

      return {
        // Always-FS operations: validate after
        materializeGhost: (...args: Parameters<typeof materializeGhost>) =>
          withPostValidation(materializeGhost(...args)),
        createRealLesson: (...args: Parameters<typeof createRealLesson>) =>
          withPostValidation(createRealLesson(...args)),
        materializeCourseWithLesson: (
          ...args: Parameters<typeof materializeCourseWithLesson>
        ) => withPostValidation(materializeCourseWithLesson(...args)),
        convertToGhost: (...args: Parameters<typeof convertToGhost>) =>
          withPostValidation(convertToGhost(...args)),
        reorderLessons: (...args: Parameters<typeof reorderLessons>) =>
          withPostValidation(reorderLessons(...args)),
        reorderSections: (...args: Parameters<typeof reorderSections>) =>
          withPostValidation(reorderSections(...args)),
        renameSection: (...args: Parameters<typeof renameSection>) =>
          withPostValidation(renameSection(...args)),
        // DB-only operations: no validation
        archiveSection,
        addGhostSection,
        addGhostLesson,
        // Conditionally-FS operations: validate internally only when FS is touched
        deleteLesson,
        renameLesson,
        moveToSection,
      };
    }),
    dependencies: [
      DBFunctionsService.Default,
      CourseRepoWriteService.Default,
      CourseRepoSyncValidationService.Default,
      NodeFileSystem.layer,
    ],
  }
) {}
