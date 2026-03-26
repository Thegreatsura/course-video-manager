/**
 * CourseEditorService Section Integration Tests
 *
 * Tests all 4 section event types against a real PGlite database.
 */

import { describe, it, expect } from "vitest";
import {
  setupEditorServiceTests,
  createCourseWithVersion,
  getSections,
  editorService as es,
  testDb,
  schema,
} from "./course-editor-service-test-setup";

setupEditorServiceTests();

// Use getter to always access current value (reassigned in beforeEach)
const svc = () => es;
const db = () => testDb;

describe("CourseEditorService — sections", () => {
  describe("create-section", () => {
    it("creates a ghost section in the database", async () => {
      const { version } = await createCourseWithVersion();
      const result = await svc().createSection(version.id, "Introduction", 0);

      expect(result).toMatchObject({
        success: true,
        sectionId: expect.any(String),
      });

      const sections = await getSections(version.id);
      expect(sections).toHaveLength(1);
      expect(sections[0]).toMatchObject({
        path: "Introduction",
        order: 1,
        repoVersionId: version.id,
      });
    });

    it("creates multiple sections with correct ordering", async () => {
      const { version } = await createCourseWithVersion();
      await svc().createSection(version.id, "Section A", 0);
      await svc().createSection(version.id, "Section B", 1);
      await svc().createSection(version.id, "Section C", 2);

      const sections = await getSections(version.id);
      expect(sections).toHaveLength(3);
      expect(sections.map((s) => s.path)).toEqual([
        "Section A",
        "Section B",
        "Section C",
      ]);
      expect(sections.map((s) => s.order)).toEqual([1, 2, 3]);
    });
  });

  describe("update-section-name", () => {
    it("renames a section with a parseable path", async () => {
      const { version } = await createCourseWithVersion();
      const [section] = await db()
        .insert(schema.sections)
        .values({
          repoVersionId: version.id,
          path: "01-introduction",
          order: 1,
        })
        .returning();

      const result = await svc().updateSectionName(
        section!.id,
        "Getting Started"
      );
      expect(result).toMatchObject({
        success: true,
        path: "01-getting-started",
      });

      const sections = await getSections(version.id);
      expect(sections[0]!.path).toBe("01-getting-started");
    });

    it("renames a ghost section by updating path without slug conversion", async () => {
      const { version } = await createCourseWithVersion();
      const createResult = await svc().createSection(
        version.id,
        "Before We Start",
        0
      );

      const result = await svc().updateSectionName(
        createResult.sectionId,
        "Getting Started"
      );
      expect(result).toMatchObject({
        success: true,
        path: "Getting Started",
      });

      const sections = await getSections(version.id);
      expect(sections[0]!.path).toBe("Getting Started");
    });

    it("returns early when slug is unchanged", async () => {
      const { version } = await createCourseWithVersion();
      const [section] = await db()
        .insert(schema.sections)
        .values({
          repoVersionId: version.id,
          path: "01-introduction",
          order: 1,
        })
        .returning();

      const result = await svc().updateSectionName(section!.id, "Introduction");
      expect(result).toMatchObject({ success: true, path: "01-introduction" });
    });
  });

  describe("archive-section", () => {
    it("archives a ghost section with no lessons (section no longer visible)", async () => {
      const { version } = await createCourseWithVersion();
      const result = await svc().createSection(version.id, "To Archive", 0);
      await svc().archiveSection(result.sectionId);

      // Section should not appear in getSectionsByRepoVersionId (filters archived)
      const sections = await getSections(version.id);
      expect(sections).toHaveLength(0);

      // But the section should still exist in the DB with archivedAt set
      const allSections = await db().query.sections.findMany();
      expect(allSections).toHaveLength(1);
      expect(allSections[0]!.archivedAt).not.toBeNull();
    });

    it("archives a ghost section and ghost lessons are preserved (not deleted)", async () => {
      const { version } = await createCourseWithVersion();
      const createResult = await svc().createSection(
        version.id,
        "To Archive",
        0
      );

      await db()
        .insert(schema.lessons)
        .values([
          {
            sectionId: createResult.sectionId,
            path: "lesson-one",
            title: "Lesson One",
            fsStatus: "ghost",
            order: 1,
          },
          {
            sectionId: createResult.sectionId,
            path: "lesson-two",
            title: "Lesson Two",
            fsStatus: "ghost",
            order: 2,
          },
        ]);

      await svc().archiveSection(createResult.sectionId);

      // Section not visible
      expect(await getSections(version.id)).toHaveLength(0);
      // Ghost lessons preserved in DB (not deleted)
      expect(await db().query.lessons.findMany()).toHaveLength(2);
    });

    it("rejects archiving a section with real lessons", async () => {
      const { version } = await createCourseWithVersion();
      const createResult = await svc().createSection(
        version.id,
        "Has Real Lessons",
        0
      );

      await db().insert(schema.lessons).values({
        sectionId: createResult.sectionId,
        path: "01.01-real-lesson",
        title: "Real Lesson",
        fsStatus: "real",
        order: 1,
      });

      await expect(
        svc().archiveSection(createResult.sectionId)
      ).rejects.toThrow();
    });

    it("rejects archiving a section with mixed ghost and real lessons", async () => {
      const { version } = await createCourseWithVersion();
      const createResult = await svc().createSection(
        version.id,
        "Mixed Lessons",
        0
      );

      await db()
        .insert(schema.lessons)
        .values([
          {
            sectionId: createResult.sectionId,
            path: "ghost-lesson",
            title: "Ghost Lesson",
            fsStatus: "ghost",
            order: 1,
          },
          {
            sectionId: createResult.sectionId,
            path: "real-lesson",
            title: "Real Lesson",
            fsStatus: "real",
            order: 2,
          },
        ]);

      await expect(
        svc().archiveSection(createResult.sectionId)
      ).rejects.toThrow();
    });

    it("double-archiving the same section does not throw", async () => {
      const { version } = await createCourseWithVersion();
      const result = await svc().createSection(version.id, "Double Archive", 0);
      await svc().archiveSection(result.sectionId);
      await svc().archiveSection(result.sectionId);

      const allSections = await db().query.sections.findMany();
      expect(allSections).toHaveLength(1);
      expect(allSections[0]!.archivedAt).not.toBeNull();
    });
  });

  describe("reorder-sections", () => {
    it("reorders ghost sections by updating order field", async () => {
      const { version } = await createCourseWithVersion();
      const r1 = await svc().createSection(version.id, "Alpha", 0);
      const r2 = await svc().createSection(version.id, "Beta", 1);
      const r3 = await svc().createSection(version.id, "Gamma", 2);

      await svc().reorderSections([r3.sectionId, r2.sectionId, r1.sectionId]);

      const sections = await getSections(version.id);
      expect(sections.map((s) => s.path)).toEqual(["Gamma", "Beta", "Alpha"]);
      expect(sections.map((s) => s.order)).toEqual([0, 1, 2]);
    });

    it("reorders parseable sections and updates paths", async () => {
      const { version } = await createCourseWithVersion();
      const [s1] = await db()
        .insert(schema.sections)
        .values({ repoVersionId: version.id, path: "01-alpha", order: 0 })
        .returning();
      const [s2] = await db()
        .insert(schema.sections)
        .values({ repoVersionId: version.id, path: "02-beta", order: 1 })
        .returning();
      const [s3] = await db()
        .insert(schema.sections)
        .values({ repoVersionId: version.id, path: "03-gamma", order: 2 })
        .returning();

      await svc().reorderSections([s3!.id, s1!.id, s2!.id]);

      const sections = await getSections(version.id);
      expect(sections.map((s) => s.path)).toEqual([
        "01-gamma",
        "02-alpha",
        "03-beta",
      ]);
      expect(sections.map((s) => s.order)).toEqual([0, 1, 2]);
    });
  });
});
