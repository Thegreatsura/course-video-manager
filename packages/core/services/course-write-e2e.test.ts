import { describe, it, expect, beforeAll } from "vitest";
import { Effect, Layer } from "effect";
import { CourseOperationsService } from "./db-course-operations.server.js";
import { VersionOperationsService } from "./db-version-operations.server.js";
import { LessonSectionOperationsService } from "./db-lesson-section-operations.server.js";
import { DrizzleService } from "./drizzle-service.server.js";
import { CourseWriteService } from "./course-write-service.js";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "../test-utils/pglite.js";

let testDb: TestDb;

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;
});

const setup = async () => {
  await truncateAllTables(testDb);

  const drizzleLayer = Layer.succeed(DrizzleService, testDb as any);

  const testLayer = Layer.mergeAll(
    CourseWriteService.Default,
    CourseOperationsService.Default,
    VersionOperationsService.Default,
    LessonSectionOperationsService.Default
  ).pipe(Layer.provide(drizzleLayer));

  const dbLayer = Layer.mergeAll(
    CourseOperationsService.Default,
    VersionOperationsService.Default,
    LessonSectionOperationsService.Default
  ).pipe(Layer.provide(drizzleLayer));

  const run = <A, E>(
    effect: Effect.Effect<
      A,
      E,
      CourseWriteService | LessonSectionOperationsService
    >
  ) => Effect.runPromise(effect.pipe(Effect.provide(testLayer)));

  const repo = await Effect.gen(function* () {
    const courseOps = yield* CourseOperationsService;
    return yield* courseOps.createCourse({
      name: "test-repo",
    });
  }).pipe(Effect.provide(dbLayer), Effect.runPromise);

  const version = await Effect.gen(function* () {
    const versionOps = yield* VersionOperationsService;
    return yield* versionOps.createCourseVersion({
      repoId: repo.id,
      name: "v1",
    });
  }).pipe(Effect.provide(dbLayer), Effect.runPromise);

  const createSection = async (sectionTitle: string, order: number) => {
    const sections = await Effect.gen(function* () {
      const lsOps = yield* LessonSectionOperationsService;
      return yield* lsOps.createSections({
        repoVersionId: version.id,
        sections: [
          { sectionPathWithNumber: sectionTitle, sectionNumber: order },
        ],
      });
    }).pipe(Effect.provide(dbLayer), Effect.runPromise);
    return sections[0]!;
  };

  const createLesson = async (
    sectionId: string,
    title: string,
    order: number
  ) => {
    const lessons = await Effect.gen(function* () {
      const lsOps = yield* LessonSectionOperationsService;
      const created = yield* lsOps.createLesson(sectionId, {
        title,
        order,
      });
      yield* lsOps.updateLesson(created[0]!.id, {
        authoringStatus: "todo",
      });
      return created;
    }).pipe(Effect.provide(dbLayer), Effect.runPromise);
    return lessons[0]!;
  };

  // Legacy numbered paths ("01.02-second"), which the move planner rewrites.
  const createLessonWithPath = async (
    sectionId: string,
    lessonPath: string,
    order: number
  ) => {
    const lessons = await Effect.gen(function* () {
      const lsOps = yield* LessonSectionOperationsService;
      return yield* lsOps.createLessons(sectionId, [
        { lessonPathWithNumber: lessonPath, lessonNumber: order },
      ]);
    }).pipe(Effect.provide(dbLayer), Effect.runPromise);
    return lessons[0]!;
  };

  const getLesson = (lessonId: string) =>
    Effect.gen(function* () {
      const lsOps = yield* LessonSectionOperationsService;
      return yield* lsOps.getLessonWithHierarchyById(lessonId);
    }).pipe(Effect.provide(dbLayer), Effect.runPromise);

  const getSection = (sectionId: string) =>
    Effect.gen(function* () {
      const lsOps = yield* LessonSectionOperationsService;
      return yield* lsOps.getSectionWithHierarchyById(sectionId);
    }).pipe(Effect.provide(dbLayer), Effect.runPromise);

  const getVersionHasChanges = () =>
    Effect.gen(function* () {
      const versionOps = yield* VersionOperationsService;
      const found = yield* versionOps.getCourseVersionById(version.id);
      return found.hasChanges;
    }).pipe(Effect.provide(dbLayer), Effect.runPromise);

  return {
    run,
    repoVersionId: version.id,
    createSection,
    createLesson,
    getLesson,
    getSection,
    createLessonWithPath,
    getVersionHasChanges,
  };
};

describe("CourseWriteService", () => {
  describe("addSection", () => {
    it("creates a section with the given title as its path", async () => {
      const { run, repoVersionId, getSection } = await setup();

      const result = await run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.addSection(repoVersionId, "Before We Start");
        })
      );

      expect(result.success).toBe(true);
      const section = await getSection(result.sectionId);
      expect(section.title).toBe("Before We Start");
    });
  });

  describe("addLesson", () => {
    it("creates a plain lesson row with authoringStatus todo", async () => {
      const { run, createSection, getLesson } = await setup();

      const section = await createSection("Intro", 1);

      const result = await run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.addLesson(section.id, "My Lesson");
        })
      );

      expect(result.success).toBe(true);
      const lesson = await getLesson(result.lessonId);
      expect(lesson.authoringStatus).toBe("todo");
      expect(lesson.title).toBe("My Lesson");
    });
  });

  describe("createLesson", () => {
    it("creates a lesson with correct slug", async () => {
      const { run, createSection, getLesson } = await setup();

      const section = await createSection("01-intro", 1);

      const result = await run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.createLesson(section.id, "My First Lesson");
        })
      );

      expect(result.success).toBe(true);
      expect(result.path).toBe("my-first-lesson");

      const lesson = await getLesson(result.lessonId);
      expect(lesson.authoringStatus).toBe("todo");
      expect(lesson.title).toBe("My First Lesson");
    });

    it("inserts before an existing lesson when position is specified", async () => {
      const { run, createSection, createLessonWithPath, getLesson } =
        await setup();

      const section = await createSection("01-intro", 1);
      const l1 = await createLessonWithPath(section.id, "01.01-first", 1);
      const l2 = await createLessonWithPath(section.id, "01.02-second", 2);

      const result = await run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.createLesson(section.id, "Inserted Lesson", {
            adjacentLessonId: l2.id,
            position: "before",
          });
        })
      );

      expect(result.success).toBe(true);

      const inserted = await getLesson(result.lessonId);
      expect(inserted.order).toBe(2);

      const updatedL2 = await getLesson(l2.id);
      expect(updatedL2.order).toBe(3);

      const updatedL1 = await getLesson(l1.id);
      expect(updatedL1.order).toBe(1);
    });
  });

  describe("LessonSectionOperationsService.deleteLesson", () => {
    it("archives one lesson without affecting siblings", async () => {
      const { run, createSection, createLessonWithPath, getLesson } =
        await setup();

      const section = await createSection("01-intro", 1);
      const l1 = await createLessonWithPath(section.id, "01.01-first", 1);
      const l2 = await createLessonWithPath(section.id, "01.02-second", 2);
      const l3 = await createLessonWithPath(section.id, "01.03-third", 3);

      await run(
        Effect.gen(function* () {
          const lsOps = yield* LessonSectionOperationsService;
          return yield* lsOps.deleteLesson(l2.id);
        })
      );

      const archivedL2 = await getLesson(l2.id);
      expect(archivedL2.archived).toBe(true);

      const updatedL1 = await getLesson(l1.id);
      expect(updatedL1.archived).toBe(false);

      const updatedL3 = await getLesson(l3.id);
      expect(updatedL3.archived).toBe(false);
    });
  });

  describe("LessonSectionOperationsService.batchUpdateLessonOrders", () => {
    it("reverses lesson order values in the database", async () => {
      const { run, createSection, createLessonWithPath, getLesson } =
        await setup();

      const section = await createSection("01-intro", 1);
      const l1 = await createLessonWithPath(section.id, "01.01-first", 1);
      const l2 = await createLessonWithPath(section.id, "01.02-second", 2);
      const l3 = await createLessonWithPath(section.id, "01.03-third", 3);

      await run(
        Effect.gen(function* () {
          const lsOps = yield* LessonSectionOperationsService;
          return yield* lsOps.batchUpdateLessonOrders([
            { id: l3.id, order: 0 },
            { id: l2.id, order: 1 },
            { id: l1.id, order: 2 },
          ]);
        })
      );

      const updated1 = await getLesson(l1.id);
      expect(updated1.order).toBe(2);

      const updated2 = await getLesson(l2.id);
      expect(updated2.order).toBe(1);

      const updated3 = await getLesson(l3.id);
      expect(updated3.order).toBe(0);
    });
  });

  describe("moveToSection", () => {
    it("moves a lesson to another section and updates DB paths via planner", async () => {
      const { run, createSection, createLessonWithPath, getLesson } =
        await setup();

      const section1 = await createSection("01-intro", 1);
      const section2 = await createSection("02-advanced", 2);

      const l1 = await createLessonWithPath(section1.id, "01.01-first", 1);
      const l2 = await createLessonWithPath(section1.id, "01.02-second", 2);
      const l3 = await createLessonWithPath(section1.id, "01.03-third", 3);
      await createLessonWithPath(section2.id, "02.01-existing", 1);

      await run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.moveToSection(l2.id, section2.id);
        })
      );

      const movedLesson = await getLesson(l2.id);
      expect(movedLesson.sectionId).toBe(section2.id);
      expect(movedLesson.title).toBe("second");

      const updatedL3 = await getLesson(l3.id);
      expect(updatedL3.title).toBe("third");

      const updatedL1 = await getLesson(l1.id);
      expect(updatedL1.title).toBe("first");
    });
  });

  describe("moveLessonsToSection", () => {
    it("moves multiple lessons to another section as a contiguous block", async () => {
      const { run, createSection, createLessonWithPath, getLesson } =
        await setup();

      const section1 = await createSection("01-intro", 1);
      const section2 = await createSection("02-advanced", 2);

      const a = await createLessonWithPath(section1.id, "01.01-a", 1);
      const b = await createLessonWithPath(section1.id, "01.02-b", 2);
      const c = await createLessonWithPath(section1.id, "01.03-c", 3);
      await createLessonWithPath(section2.id, "02.01-existing", 1);

      await run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.moveLessonsToSection([a.id, c.id], section2.id);
        })
      );

      const movedA = await getLesson(a.id);
      const movedC = await getLesson(c.id);
      expect(movedA.sectionId).toBe(section2.id);
      expect(movedA.title).toBe("a");
      expect(movedC.sectionId).toBe(section2.id);
      expect(movedC.title).toBe("c");

      const keptB = await getLesson(b.id);
      expect(keptB.sectionId).toBe(section1.id);
      expect(keptB.title).toBe("b");
    });
  });

  describe("renameSection", () => {
    it("updates the section path in the database", async () => {
      const { run, createSection, getSection } = await setup();

      const section = await createSection("01-intro", 1);

      const result = await run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.renameSection(section.id, "introduction");
        })
      );

      expect(result.success).toBe(true);
      expect(result.title).toBe("introduction");

      const updated = await getSection(section.id);
      expect(updated.title).toBe("introduction");
    });

    it("is a no-op when the new slug matches the current path", async () => {
      const { run, createSection, getSection } = await setup();

      const section = await createSection("01-intro", 1);

      const result = await run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.renameSection(section.id, "01-intro");
        })
      );

      expect(result.success).toBe(true);
      expect(result.title).toBe("01-intro");

      const updated = await getSection(section.id);
      expect(updated.title).toBe("01-intro");
    });
  });

  describe("LessonSectionOperationsService.batchUpdateSectionOrders", () => {
    it("updates section order values in the database", async () => {
      const { run, createSection, getSection } = await setup();

      const section1 = await createSection("01-intro", 1);
      const section2 = await createSection("02-advanced", 2);

      await run(
        Effect.gen(function* () {
          const lsOps = yield* LessonSectionOperationsService;
          return yield* lsOps.batchUpdateSectionOrders([
            { id: section2.id, order: 0 },
            { id: section1.id, order: 1 },
          ]);
        })
      );

      const updatedSection1 = await getSection(section1.id);
      expect(updatedSection1.order).toBe(1);

      const updatedSection2 = await getSection(section2.id);
      expect(updatedSection2.order).toBe(0);
    });
  });

  describe("hasChanges", () => {
    it("flips true once a write lands on the Draft Version", async () => {
      const { run, repoVersionId, getVersionHasChanges } = await setup();

      expect(await getVersionHasChanges()).toBe(false);

      await run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.addSection(repoVersionId, "Before We Start");
        })
      );

      expect(await getVersionHasChanges()).toBe(true);
    });

    it("stays true across further writes (archiveSection included)", async () => {
      const { run, createSection, createLesson, getVersionHasChanges } =
        await setup();

      const section = await createSection("Intro", 1);
      await createLesson(section.id, "Lesson", 1);
      expect(await getVersionHasChanges()).toBe(true);

      await run(
        Effect.gen(function* () {
          const lsOps = yield* LessonSectionOperationsService;
          return yield* lsOps.archiveSection(section.id);
        })
      );

      expect(await getVersionHasChanges()).toBe(true);
    });
  });
});
