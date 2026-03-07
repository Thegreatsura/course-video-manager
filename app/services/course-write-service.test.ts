import { describe, it, expect, afterEach, beforeAll } from "vitest";
import { Effect, Layer } from "effect";
import { DBFunctionsService } from "@/services/db-service.server";
import { DrizzleService } from "@/services/drizzle-service.server";
import { CourseWriteService } from "@/services/course-write-service";
import { NodeContext } from "@effect/platform-node";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/pglite";

let tempDir: string;
let testDb: TestDb;

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;
});

const setupTempGitRepo = () => {
  tempDir = fs.mkdtempSync(path.join(tmpdir(), "course-write-test-"));
  execSync("git init", { cwd: tempDir });
  execSync('git config user.email "test@test.com"', { cwd: tempDir });
  execSync('git config user.name "Test"', { cwd: tempDir });
  fs.writeFileSync(path.join(tempDir, ".gitkeep"), "");
  execSync("git add . && git commit -m 'init'", { cwd: tempDir });
};

/**
 * Creates test infrastructure: temp git repo + composed layer using shared PGlite.
 * Returns seed helpers and a run function for executing effects.
 */
const setup = async () => {
  setupTempGitRepo();
  await truncateAllTables(testDb);

  const drizzleLayer = Layer.succeed(DrizzleService, testDb as any);

  const testLayer = Layer.mergeAll(
    CourseWriteService.Default,
    DBFunctionsService.Default
  ).pipe(Layer.provide(drizzleLayer), Layer.provide(NodeContext.layer));

  const dbLayer = DBFunctionsService.Default.pipe(Layer.provide(drizzleLayer));

  const run = <A, E>(effect: Effect.Effect<A, E, CourseWriteService>) =>
    Effect.runPromise(effect.pipe(Effect.provide(testLayer)));

  // Seed repo + version
  const repo = await Effect.gen(function* () {
    const db = yield* DBFunctionsService;
    return yield* db.createRepo({ filePath: tempDir, name: "test-repo" });
  }).pipe(Effect.provide(dbLayer), Effect.runPromise);

  const version = await Effect.gen(function* () {
    const db = yield* DBFunctionsService;
    return yield* db.createRepoVersion({ repoId: repo.id, name: "v1" });
  }).pipe(Effect.provide(dbLayer), Effect.runPromise);

  const createSection = async (sectionPath: string, order: number) => {
    const sectionDir = path.join(tempDir, sectionPath);
    fs.mkdirSync(sectionDir, { recursive: true });
    fs.writeFileSync(path.join(sectionDir, ".gitkeep"), "");
    execSync(`git add . && git commit -m 'add ${sectionPath}'`, {
      cwd: tempDir,
    });
    const sections = await Effect.gen(function* () {
      const db = yield* DBFunctionsService;
      return yield* db.createSections({
        repoVersionId: version.id,
        sections: [
          { sectionPathWithNumber: sectionPath, sectionNumber: order },
        ],
      });
    }).pipe(Effect.provide(dbLayer), Effect.runPromise);
    return sections[0]!;
  };

  const createRealLesson = async (
    sectionId: string,
    sectionPath: string,
    lessonPath: string,
    order: number
  ) => {
    const explainerDir = path.join(
      tempDir,
      sectionPath,
      lessonPath,
      "explainer"
    );
    fs.mkdirSync(explainerDir, { recursive: true });
    fs.writeFileSync(path.join(explainerDir, "readme.md"), "# Test\n");
    execSync(`git add . && git commit -m 'add ${lessonPath}'`, {
      cwd: tempDir,
    });
    const lessons = await Effect.gen(function* () {
      const db = yield* DBFunctionsService;
      return yield* db.createLessons(sectionId, [
        { lessonPathWithNumber: lessonPath, lessonNumber: order },
      ]);
    }).pipe(Effect.provide(dbLayer), Effect.runPromise);
    return lessons[0]!;
  };

  const createGhostLesson = async (
    sectionId: string,
    title: string,
    slug: string,
    order: number
  ) => {
    const lesson = await Effect.gen(function* () {
      const db = yield* DBFunctionsService;
      return yield* db.createGhostLesson(sectionId, {
        title,
        path: slug,
        order,
      });
    }).pipe(Effect.provide(dbLayer), Effect.runPromise);
    return lesson[0]!;
  };

  /** Creates a section in DB only (no directory on disk). */
  const createGhostSection = async (sectionPath: string, order: number) => {
    const sections = await Effect.gen(function* () {
      const db = yield* DBFunctionsService;
      return yield* db.createSections({
        repoVersionId: version.id,
        sections: [
          { sectionPathWithNumber: sectionPath, sectionNumber: order },
        ],
      });
    }).pipe(Effect.provide(dbLayer), Effect.runPromise);
    return sections[0]!;
  };

  const getLesson = (lessonId: string) =>
    Effect.gen(function* () {
      const db = yield* DBFunctionsService;
      return yield* db.getLessonWithHierarchyById(lessonId);
    }).pipe(Effect.provide(dbLayer), Effect.runPromise);

  const getSection = (sectionId: string) =>
    Effect.gen(function* () {
      const db = yield* DBFunctionsService;
      return yield* db.getSectionWithHierarchyById(sectionId);
    }).pipe(Effect.provide(dbLayer), Effect.runPromise);

  return {
    run,
    repoVersionId: version.id,
    createSection,
    createGhostSection,
    createRealLesson,
    createGhostLesson,
    getLesson,
    getSection,
  };
};

describe("CourseWriteService", () => {
  afterEach(() => {
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe("materializeGhost", () => {
    it("ghost at the end: creates directory, no shifts needed", async () => {
      const {
        run,
        createSection,
        createRealLesson,
        createGhostLesson,
        getLesson,
      } = await setup();

      const section = await createSection("01-intro", 1);
      await createRealLesson(section.id, "01-intro", "01.01-first-lesson", 1);
      const ghost = await createGhostLesson(
        section.id,
        "Second Lesson",
        "second-lesson",
        2
      );

      const result = await run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.materializeGhost(ghost.id);
        })
      );

      expect(result.path).toBe("01.02-second-lesson");

      // Verify directory was created
      expect(
        fs.existsSync(
          path.join(
            tempDir,
            "01-intro",
            "01.02-second-lesson",
            "explainer",
            "readme.md"
          )
        )
      ).toBe(true);

      // Verify DB updated
      const updated = await getLesson(ghost.id);
      expect(updated.fsStatus).toBe("real");
      expect(updated.path).toBe("01.02-second-lesson");
    });

    it("ghost in the middle: creates directory AND shifts subsequent real lessons", async () => {
      const {
        run,
        createSection,
        createRealLesson,
        createGhostLesson,
        getLesson,
      } = await setup();

      const section = await createSection("01-intro", 1);
      const real1 = await createRealLesson(
        section.id,
        "01-intro",
        "01.01-first-lesson",
        1
      );
      const ghost = await createGhostLesson(
        section.id,
        "Middle Lesson",
        "middle-lesson",
        2
      );
      const real2 = await createRealLesson(
        section.id,
        "01-intro",
        "01.02-third-lesson",
        3
      );

      const result = await run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.materializeGhost(ghost.id);
        })
      );

      // Ghost (order=2) is between real1 (order=1) and real2 (order=3)
      // insertAtIndex = 1, new lesson = 01.02, real2 shifts 01.02 → 01.03
      expect(result.path).toBe("01.02-middle-lesson");

      // New directory created
      expect(
        fs.existsSync(path.join(tempDir, "01-intro", "01.02-middle-lesson"))
      ).toBe(true);

      // Shifted lesson directory renamed
      expect(
        fs.existsSync(path.join(tempDir, "01-intro", "01.03-third-lesson"))
      ).toBe(true);
      expect(
        fs.existsSync(path.join(tempDir, "01-intro", "01.02-third-lesson"))
      ).toBe(false);

      // DB: ghost is now real
      const updatedGhost = await getLesson(ghost.id);
      expect(updatedGhost.fsStatus).toBe("real");
      expect(updatedGhost.path).toBe("01.02-middle-lesson");

      // DB: shifted lesson path updated
      const updatedReal2 = await getLesson(real2.id);
      expect(updatedReal2.path).toBe("01.03-third-lesson");

      // DB: first real lesson unchanged
      const updatedReal1 = await getLesson(real1.id);
      expect(updatedReal1.path).toBe("01.01-first-lesson");
    });

    it("ghost at the beginning: shifts all real lessons", async () => {
      const {
        run,
        createSection,
        createRealLesson,
        createGhostLesson,
        getLesson,
      } = await setup();

      const section = await createSection("01-intro", 1);
      const ghost = await createGhostLesson(
        section.id,
        "Before All",
        "before-all",
        0
      );
      const real1 = await createRealLesson(
        section.id,
        "01-intro",
        "01.01-first-lesson",
        1
      );
      const real2 = await createRealLesson(
        section.id,
        "01-intro",
        "01.02-second-lesson",
        2
      );

      const result = await run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.materializeGhost(ghost.id);
        })
      );

      // Ghost (order=0) before all reals, insertAtIndex = 0
      // New = 01.01, real1 shifts 01.01 → 01.02, real2 shifts 01.02 → 01.03
      expect(result.path).toBe("01.01-before-all");

      // Verify directories
      expect(
        fs.existsSync(path.join(tempDir, "01-intro", "01.01-before-all"))
      ).toBe(true);
      expect(
        fs.existsSync(path.join(tempDir, "01-intro", "01.02-first-lesson"))
      ).toBe(true);
      expect(
        fs.existsSync(path.join(tempDir, "01-intro", "01.03-second-lesson"))
      ).toBe(true);

      // Old paths gone
      expect(
        fs.existsSync(path.join(tempDir, "01-intro", "01.01-first-lesson"))
      ).toBe(false);
      expect(
        fs.existsSync(path.join(tempDir, "01-intro", "01.02-second-lesson"))
      ).toBe(false);

      // Verify DB
      const updatedGhost = await getLesson(ghost.id);
      expect(updatedGhost.path).toBe("01.01-before-all");

      const updatedReal1 = await getLesson(real1.id);
      expect(updatedReal1.path).toBe("01.02-first-lesson");

      const updatedReal2 = await getLesson(real2.id);
      expect(updatedReal2.path).toBe("01.03-second-lesson");
    });

    it("multiple ghosts interspersed: only real lessons are shifted", async () => {
      const {
        run,
        createSection,
        createRealLesson,
        createGhostLesson,
        getLesson,
      } = await setup();

      const section = await createSection("01-intro", 1);

      // Order: real1(1), ghost1(2), ghost2(3), real2(4)
      const real1 = await createRealLesson(
        section.id,
        "01-intro",
        "01.01-first",
        1
      );
      await createGhostLesson(section.id, "Ghost One", "ghost-one", 2);
      const ghost2 = await createGhostLesson(
        section.id,
        "Ghost Two",
        "ghost-two",
        3
      );
      const real2 = await createRealLesson(
        section.id,
        "01-intro",
        "01.02-fourth",
        4
      );

      // Materialize ghost2 (order=3)
      // Real lessons: real1(order=1), real2(order=4)
      // insertAtIndex = 1 (real2 order=4 > ghost order=3)
      // New = 01.02, real2 shifts 01.02 → 01.03
      const result = await run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.materializeGhost(ghost2.id);
        })
      );

      expect(result.path).toBe("01.02-ghost-two");

      // Verify filesystem
      expect(fs.existsSync(path.join(tempDir, "01-intro", "01.01-first"))).toBe(
        true
      );
      expect(
        fs.existsSync(path.join(tempDir, "01-intro", "01.02-ghost-two"))
      ).toBe(true);
      expect(
        fs.existsSync(path.join(tempDir, "01-intro", "01.03-fourth"))
      ).toBe(true);
      expect(
        fs.existsSync(path.join(tempDir, "01-intro", "01.02-fourth"))
      ).toBe(false);

      // Verify DB
      const updatedReal1 = await getLesson(real1.id);
      expect(updatedReal1.path).toBe("01.01-first");

      const updatedReal2 = await getLesson(real2.id);
      expect(updatedReal2.path).toBe("01.03-fourth");
    });

    it("rejects materializing a lesson that is already on disk", async () => {
      const { run, createSection, createRealLesson } = await setup();

      const section = await createSection("01-intro", 1);
      const real = await createRealLesson(
        section.id,
        "01-intro",
        "01.01-already-real",
        1
      );

      await expect(
        run(
          Effect.gen(function* () {
            const service = yield* CourseWriteService;
            return yield* service.materializeGhost(real.id);
          })
        )
      ).rejects.toThrow();
    });
  });

  describe("addGhostLesson", () => {
    it("creates a ghost lesson appended at end of section", async () => {
      const { run, createSection, createRealLesson, getLesson } = await setup();

      const section = await createSection("01-intro", 1);
      await createRealLesson(section.id, "01-intro", "01.01-first", 1);

      const result = await run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.addGhostLesson(section.id, "My New Lesson");
        })
      );

      expect(result.success).toBe(true);
      expect(result.lessonId).toBeDefined();

      const lesson = await getLesson(result.lessonId);
      expect(lesson.fsStatus).toBe("ghost");
      expect(lesson.title).toBe("My New Lesson");
      expect(lesson.path).toBe("my-new-lesson");
      expect(lesson.order).toBe(2);
    });

    it("creates first ghost lesson with order 1", async () => {
      const { run, createSection, getLesson } = await setup();

      const section = await createSection("01-intro", 1);

      const result = await run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.addGhostLesson(section.id, "First Lesson");
        })
      );

      const lesson = await getLesson(result.lessonId);
      expect(lesson.order).toBe(1);
    });
  });

  describe("deleteLesson", () => {
    it("deletes a real lesson from disk and database", async () => {
      const { run, createSection, createRealLesson, getLesson } = await setup();

      const section = await createSection("01-intro", 1);
      const real = await createRealLesson(
        section.id,
        "01-intro",
        "01.01-to-delete",
        1
      );

      // Verify directory exists before
      expect(
        fs.existsSync(path.join(tempDir, "01-intro", "01.01-to-delete"))
      ).toBe(true);

      await run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.deleteLesson(real.id);
        })
      );

      // Directory removed from disk
      expect(
        fs.existsSync(path.join(tempDir, "01-intro", "01.01-to-delete"))
      ).toBe(false);

      // Record removed from DB
      await expect(getLesson(real.id)).rejects.toThrow();
    });

    it("deletes a ghost lesson from database only (no filesystem ops)", async () => {
      const { run, createSection, createGhostLesson, getLesson } =
        await setup();

      const section = await createSection("01-intro", 1);
      const ghost = await createGhostLesson(
        section.id,
        "Ghost Lesson",
        "ghost-lesson",
        1
      );

      await run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.deleteLesson(ghost.id);
        })
      );

      // Record removed from DB
      await expect(getLesson(ghost.id)).rejects.toThrow();
    });
  });

  describe("convertToGhost", () => {
    it("converts a real lesson in the middle: deletes dir and renumbers remaining", async () => {
      const { run, createSection, createRealLesson, getLesson } = await setup();

      const section = await createSection("01-intro", 1);
      const real1 = await createRealLesson(
        section.id,
        "01-intro",
        "01.01-first",
        1
      );
      const real2 = await createRealLesson(
        section.id,
        "01-intro",
        "01.02-second",
        2
      );
      const real3 = await createRealLesson(
        section.id,
        "01-intro",
        "01.03-third",
        3
      );

      await run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.convertToGhost(real2.id);
        })
      );

      // Converted lesson is now ghost
      const updatedReal2 = await getLesson(real2.id);
      expect(updatedReal2.fsStatus).toBe("ghost");

      // Directory removed
      expect(
        fs.existsSync(path.join(tempDir, "01-intro", "01.02-second"))
      ).toBe(false);

      // First lesson unchanged
      const updatedReal1 = await getLesson(real1.id);
      expect(updatedReal1.path).toBe("01.01-first");
      expect(fs.existsSync(path.join(tempDir, "01-intro", "01.01-first"))).toBe(
        true
      );

      // Third lesson renumbered to close gap: 01.03 → 01.02
      const updatedReal3 = await getLesson(real3.id);
      expect(updatedReal3.path).toBe("01.02-third");
      expect(fs.existsSync(path.join(tempDir, "01-intro", "01.02-third"))).toBe(
        true
      );
      expect(fs.existsSync(path.join(tempDir, "01-intro", "01.03-third"))).toBe(
        false
      );
    });

    it("converts a real lesson at the end: deletes dir, no renumbering needed", async () => {
      const { run, createSection, createRealLesson, getLesson } = await setup();

      const section = await createSection("01-intro", 1);
      const real1 = await createRealLesson(
        section.id,
        "01-intro",
        "01.01-first",
        1
      );
      const real2 = await createRealLesson(
        section.id,
        "01-intro",
        "01.02-last",
        2
      );

      await run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.convertToGhost(real2.id);
        })
      );

      // Converted lesson is ghost
      const updatedReal2 = await getLesson(real2.id);
      expect(updatedReal2.fsStatus).toBe("ghost");

      // Directory removed
      expect(fs.existsSync(path.join(tempDir, "01-intro", "01.02-last"))).toBe(
        false
      );

      // First lesson unchanged
      const updatedReal1 = await getLesson(real1.id);
      expect(updatedReal1.path).toBe("01.01-first");
    });

    it("rejects converting a lesson that is already a ghost", async () => {
      const { run, createSection, createGhostLesson } = await setup();

      const section = await createSection("01-intro", 1);
      const ghost = await createGhostLesson(section.id, "Ghost", "ghost", 1);

      await expect(
        run(
          Effect.gen(function* () {
            const service = yield* CourseWriteService;
            return yield* service.convertToGhost(ghost.id);
          })
        )
      ).rejects.toThrow();
    });
  });

  describe("renameLesson", () => {
    it("renames a real lesson slug via git mv and updates DB path", async () => {
      const { run, createSection, createRealLesson, getLesson } = await setup();

      const section = await createSection("01-intro", 1);
      const real = await createRealLesson(
        section.id,
        "01-intro",
        "01.01-old-slug",
        1
      );

      const result = await run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.renameLesson(real.id, "new-slug");
        })
      );

      expect(result.path).toBe("01.01-new-slug");

      // Old dir gone, new dir exists
      expect(
        fs.existsSync(path.join(tempDir, "01-intro", "01.01-old-slug"))
      ).toBe(false);
      expect(
        fs.existsSync(path.join(tempDir, "01-intro", "01.01-new-slug"))
      ).toBe(true);

      // DB updated
      const updated = await getLesson(real.id);
      expect(updated.path).toBe("01.01-new-slug");
    });

    it("is a no-op when slug hasn't changed", async () => {
      const { run, createSection, createRealLesson, getLesson } = await setup();

      const section = await createSection("01-intro", 1);
      const real = await createRealLesson(
        section.id,
        "01-intro",
        "01.01-same-slug",
        1
      );

      const result = await run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.renameLesson(real.id, "same-slug");
        })
      );

      expect(result.path).toBe("01.01-same-slug");

      // Directory unchanged
      expect(
        fs.existsSync(path.join(tempDir, "01-intro", "01.01-same-slug"))
      ).toBe(true);

      // DB unchanged
      const updated = await getLesson(real.id);
      expect(updated.path).toBe("01.01-same-slug");
    });

    it("renames a ghost lesson (DB only, no filesystem ops)", async () => {
      const { run, createSection, createGhostLesson, getLesson } =
        await setup();

      const section = await createSection("01-intro", 1);
      const ghost = await createGhostLesson(
        section.id,
        "Old Title",
        "old-title",
        1
      );

      const result = await run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.renameLesson(ghost.id, "new-title");
        })
      );

      expect(result.success).toBe(true);
      expect(result.path).toBe("new-title");

      // DB updated
      const updated = await getLesson(ghost.id);
      expect(updated.path).toBe("new-title");
    });
  });

  describe("reorderLessons", () => {
    it("reorders real lessons: renames dirs on disk and updates DB paths and order", async () => {
      const { run, createSection, createRealLesson, getLesson } = await setup();

      const section = await createSection("01-intro", 1);
      const real1 = await createRealLesson(
        section.id,
        "01-intro",
        "01.01-first",
        1
      );
      const real2 = await createRealLesson(
        section.id,
        "01-intro",
        "01.02-second",
        2
      );
      const real3 = await createRealLesson(
        section.id,
        "01-intro",
        "01.03-third",
        3
      );

      // Reverse order: third, second, first
      await run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.reorderLessons(section.id, [
            real3.id,
            real2.id,
            real1.id,
          ]);
        })
      );

      // Filesystem: dirs renamed to match new order
      expect(fs.existsSync(path.join(tempDir, "01-intro", "01.01-third"))).toBe(
        true
      );
      expect(
        fs.existsSync(path.join(tempDir, "01-intro", "01.02-second"))
      ).toBe(true);
      expect(fs.existsSync(path.join(tempDir, "01-intro", "01.03-first"))).toBe(
        true
      );

      // Old paths gone
      expect(fs.existsSync(path.join(tempDir, "01-intro", "01.01-first"))).toBe(
        false
      );
      expect(fs.existsSync(path.join(tempDir, "01-intro", "01.03-third"))).toBe(
        false
      );

      // DB paths updated
      const updated1 = await getLesson(real1.id);
      expect(updated1.path).toBe("01.03-first");
      expect(updated1.order).toBe(2);

      const updated2 = await getLesson(real2.id);
      expect(updated2.path).toBe("01.02-second");
      expect(updated2.order).toBe(1);

      const updated3 = await getLesson(real3.id);
      expect(updated3.path).toBe("01.01-third");
      expect(updated3.order).toBe(0);
    });

    it("reorder with mixed ghost + real: only real lessons renamed on disk, all get updated order", async () => {
      const {
        run,
        createSection,
        createRealLesson,
        createGhostLesson,
        getLesson,
      } = await setup();

      const section = await createSection("01-intro", 1);
      const real1 = await createRealLesson(
        section.id,
        "01-intro",
        "01.01-first",
        1
      );
      const ghost = await createGhostLesson(
        section.id,
        "Ghost Lesson",
        "ghost-lesson",
        2
      );
      const real2 = await createRealLesson(
        section.id,
        "01-intro",
        "01.02-third",
        3
      );

      // New order: real2, ghost, real1
      await run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.reorderLessons(section.id, [
            real2.id,
            ghost.id,
            real1.id,
          ]);
        })
      );

      // Real lessons swapped on disk
      expect(fs.existsSync(path.join(tempDir, "01-intro", "01.01-third"))).toBe(
        true
      );
      expect(fs.existsSync(path.join(tempDir, "01-intro", "01.02-first"))).toBe(
        true
      );

      // DB paths updated for real lessons
      const updatedReal1 = await getLesson(real1.id);
      expect(updatedReal1.path).toBe("01.02-first");
      expect(updatedReal1.order).toBe(2);

      const updatedReal2 = await getLesson(real2.id);
      expect(updatedReal2.path).toBe("01.01-third");
      expect(updatedReal2.order).toBe(0);

      // Ghost lesson: no filesystem change, order updated
      const updatedGhost = await getLesson(ghost.id);
      expect(updatedGhost.path).toBe("ghost-lesson"); // unchanged
      expect(updatedGhost.order).toBe(1);
    });

    it("no-op when order hasn't changed", async () => {
      const { run, createSection, createRealLesson, getLesson } = await setup();

      const section = await createSection("01-intro", 1);
      const real1 = await createRealLesson(
        section.id,
        "01-intro",
        "01.01-first",
        1
      );
      const real2 = await createRealLesson(
        section.id,
        "01-intro",
        "01.02-second",
        2
      );

      const result = await run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.reorderLessons(section.id, [
            real1.id,
            real2.id,
          ]);
        })
      );

      expect(result.renames).toHaveLength(0);

      // Filesystem unchanged
      expect(fs.existsSync(path.join(tempDir, "01-intro", "01.01-first"))).toBe(
        true
      );
      expect(
        fs.existsSync(path.join(tempDir, "01-intro", "01.02-second"))
      ).toBe(true);

      // DB paths unchanged
      const updated1 = await getLesson(real1.id);
      expect(updated1.path).toBe("01.01-first");

      const updated2 = await getLesson(real2.id);
      expect(updated2.path).toBe("01.02-second");
    });
  });

  describe("moveToSection", () => {
    it("moves a real lesson: directory moved, source renumbered, DB updated", async () => {
      const { run, createSection, createRealLesson, getLesson } = await setup();

      const section1 = await createSection("01-intro", 1);
      const section2 = await createSection("02-advanced", 2);

      const real1 = await createRealLesson(
        section1.id,
        "01-intro",
        "01.01-first",
        1
      );
      const real2 = await createRealLesson(
        section1.id,
        "01-intro",
        "01.02-second",
        2
      );
      const real3 = await createRealLesson(
        section1.id,
        "01-intro",
        "01.03-third",
        3
      );
      // Target section has one existing lesson
      await createRealLesson(section2.id, "02-advanced", "02.01-existing", 1);

      // Move real2 from section1 to section2
      await run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.moveToSection(real2.id, section2.id);
        })
      );

      // Lesson directory moved to target section with correct numbering
      expect(
        fs.existsSync(path.join(tempDir, "02-advanced", "02.02-second"))
      ).toBe(true);
      // Old location gone
      expect(
        fs.existsSync(path.join(tempDir, "01-intro", "01.02-second"))
      ).toBe(false);

      // Source section renumbered: third lesson closes the gap (01.03 → 01.02)
      expect(fs.existsSync(path.join(tempDir, "01-intro", "01.01-first"))).toBe(
        true
      );
      expect(fs.existsSync(path.join(tempDir, "01-intro", "01.02-third"))).toBe(
        true
      );
      expect(fs.existsSync(path.join(tempDir, "01-intro", "01.03-third"))).toBe(
        false
      );

      // DB: moved lesson updated
      const movedLesson = await getLesson(real2.id);
      expect(movedLesson.sectionId).toBe(section2.id);
      expect(movedLesson.path).toBe("02.02-second");

      // DB: source section renumbered
      const updatedReal3 = await getLesson(real3.id);
      expect(updatedReal3.path).toBe("01.02-third");

      // DB: first lesson unchanged
      const updatedReal1 = await getLesson(real1.id);
      expect(updatedReal1.path).toBe("01.01-first");
    });

    it("moves a ghost lesson: DB-only update, no filesystem ops", async () => {
      const { run, createSection, createGhostLesson, getLesson } =
        await setup();

      const section1 = await createSection("01-intro", 1);
      const section2 = await createSection("02-advanced", 2);

      const ghost = await createGhostLesson(
        section1.id,
        "Ghost Lesson",
        "ghost-lesson",
        1
      );

      await run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.moveToSection(ghost.id, section2.id);
        })
      );

      // DB: moved to target section
      const movedLesson = await getLesson(ghost.id);
      expect(movedLesson.sectionId).toBe(section2.id);
      expect(movedLesson.fsStatus).toBe("ghost");
      expect(movedLesson.path).toBe("ghost-lesson"); // path unchanged for ghost
    });

    it("moves a real lesson to an empty section", async () => {
      const { run, createSection, createRealLesson, getLesson } = await setup();

      const section1 = await createSection("01-intro", 1);
      const section2 = await createSection("02-advanced", 2);

      const real1 = await createRealLesson(
        section1.id,
        "01-intro",
        "01.01-only-lesson",
        1
      );

      await run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.moveToSection(real1.id, section2.id);
        })
      );

      // Moved to target section as first lesson
      expect(
        fs.existsSync(path.join(tempDir, "02-advanced", "02.01-only-lesson"))
      ).toBe(true);
      expect(
        fs.existsSync(path.join(tempDir, "01-intro", "01.01-only-lesson"))
      ).toBe(false);

      const movedLesson = await getLesson(real1.id);
      expect(movedLesson.sectionId).toBe(section2.id);
      expect(movedLesson.path).toBe("02.01-only-lesson");
    });
  });

  describe("renameSection", () => {
    it("renames a section slug via git mv and updates DB path", async () => {
      const { run, createSection, getSection } = await setup();

      const section = await createSection("01-intro", 1);

      const result = await run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.renameSection(section.id, "introduction");
        })
      );

      expect(result.path).toBe("01-introduction");

      // Old dir gone, new dir exists
      expect(fs.existsSync(path.join(tempDir, "01-intro"))).toBe(false);
      expect(fs.existsSync(path.join(tempDir, "01-introduction"))).toBe(true);

      // DB updated
      const updated = await getSection(section.id);
      expect(updated.path).toBe("01-introduction");
    });

    it("is a no-op when slug hasn't changed", async () => {
      const { run, createSection, getSection } = await setup();

      const section = await createSection("01-intro", 1);

      const result = await run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.renameSection(section.id, "intro");
        })
      );

      expect(result.path).toBe("01-intro");

      // Directory unchanged
      expect(fs.existsSync(path.join(tempDir, "01-intro"))).toBe(true);

      // DB unchanged
      const updated = await getSection(section.id);
      expect(updated.path).toBe("01-intro");
    });

    it("renames section with real lessons: lesson dirs preserved inside renamed section", async () => {
      const { run, createSection, createRealLesson, getSection, getLesson } =
        await setup();

      const section = await createSection("01-intro", 1);
      const real1 = await createRealLesson(
        section.id,
        "01-intro",
        "01.01-first-lesson",
        1
      );

      const result = await run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.renameSection(section.id, "introduction");
        })
      );

      expect(result.path).toBe("01-introduction");

      // Section directory renamed
      expect(fs.existsSync(path.join(tempDir, "01-intro"))).toBe(false);
      expect(fs.existsSync(path.join(tempDir, "01-introduction"))).toBe(true);

      // Lesson directory preserved inside renamed section
      expect(
        fs.existsSync(
          path.join(tempDir, "01-introduction", "01.01-first-lesson")
        )
      ).toBe(true);

      // DB: section path updated
      const updated = await getSection(section.id);
      expect(updated.path).toBe("01-introduction");

      // DB: lesson path unchanged (section number didn't change)
      const updatedLesson = await getLesson(real1.id);
      expect(updatedLesson.path).toBe("01.01-first-lesson");
    });
  });

  describe("reorderSections", () => {
    it("section swap: directories renamed, nested lesson paths updated on disk and in DB", async () => {
      const { run, createSection, createRealLesson, getLesson, getSection } =
        await setup();

      const section1 = await createSection("01-intro", 1);
      const section2 = await createSection("02-advanced", 2);

      const lesson1 = await createRealLesson(
        section1.id,
        "01-intro",
        "01.01-first-lesson",
        1
      );
      const lesson2 = await createRealLesson(
        section2.id,
        "02-advanced",
        "02.01-second-lesson",
        1
      );

      // Swap sections: advanced first, intro second
      await run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.reorderSections([section2.id, section1.id]);
        })
      );

      // Section directories swapped on disk
      expect(fs.existsSync(path.join(tempDir, "01-advanced"))).toBe(true);
      expect(fs.existsSync(path.join(tempDir, "02-intro"))).toBe(true);
      expect(fs.existsSync(path.join(tempDir, "01-intro"))).toBe(false);
      expect(fs.existsSync(path.join(tempDir, "02-advanced"))).toBe(false);

      // Lesson directories within renamed sections updated
      expect(
        fs.existsSync(path.join(tempDir, "01-advanced", "01.01-second-lesson"))
      ).toBe(true);
      expect(
        fs.existsSync(path.join(tempDir, "02-intro", "02.01-first-lesson"))
      ).toBe(true);

      // Old lesson paths gone
      expect(
        fs.existsSync(path.join(tempDir, "01-advanced", "02.01-second-lesson"))
      ).toBe(false);
      expect(
        fs.existsSync(path.join(tempDir, "02-intro", "01.01-first-lesson"))
      ).toBe(false);

      // DB: section paths updated
      const updatedSection1 = await getSection(section1.id);
      expect(updatedSection1.path).toBe("02-intro");
      expect(updatedSection1.order).toBe(1);

      const updatedSection2 = await getSection(section2.id);
      expect(updatedSection2.path).toBe("01-advanced");
      expect(updatedSection2.order).toBe(0);

      // DB: lesson paths updated with new section number prefix
      const updatedLesson1 = await getLesson(lesson1.id);
      expect(updatedLesson1.path).toBe("02.01-first-lesson");

      const updatedLesson2 = await getLesson(lesson2.id);
      expect(updatedLesson2.path).toBe("01.01-second-lesson");
    });

    it("no-op when order hasn't changed", async () => {
      const { run, createSection, createRealLesson, getLesson, getSection } =
        await setup();

      const section1 = await createSection("01-intro", 1);
      const section2 = await createSection("02-advanced", 2);

      const lesson1 = await createRealLesson(
        section1.id,
        "01-intro",
        "01.01-first",
        1
      );

      await run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.reorderSections([section1.id, section2.id]);
        })
      );

      // Filesystem unchanged
      expect(fs.existsSync(path.join(tempDir, "01-intro"))).toBe(true);
      expect(fs.existsSync(path.join(tempDir, "02-advanced"))).toBe(true);
      expect(fs.existsSync(path.join(tempDir, "01-intro", "01.01-first"))).toBe(
        true
      );

      // DB unchanged
      const updatedSection1 = await getSection(section1.id);
      expect(updatedSection1.path).toBe("01-intro");

      const updatedLesson1 = await getLesson(lesson1.id);
      expect(updatedLesson1.path).toBe("01.01-first");
    });

    it("section with ghost lessons: only real lesson paths updated, ghosts unchanged", async () => {
      const {
        run,
        createSection,
        createRealLesson,
        createGhostLesson,
        getLesson,
        getSection,
      } = await setup();

      const section1 = await createSection("01-intro", 1);
      const section2 = await createSection("02-advanced", 2);

      const real1 = await createRealLesson(
        section1.id,
        "01-intro",
        "01.01-real-lesson",
        1
      );
      const ghost1 = await createGhostLesson(
        section1.id,
        "Ghost Lesson",
        "ghost-lesson",
        2
      );

      // Swap sections
      await run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.reorderSections([section2.id, section1.id]);
        })
      );

      // Section directories swapped
      expect(fs.existsSync(path.join(tempDir, "01-advanced"))).toBe(true);
      expect(fs.existsSync(path.join(tempDir, "02-intro"))).toBe(true);

      // Real lesson path updated
      expect(
        fs.existsSync(path.join(tempDir, "02-intro", "02.01-real-lesson"))
      ).toBe(true);

      // DB: real lesson path updated
      const updatedReal = await getLesson(real1.id);
      expect(updatedReal.path).toBe("02.01-real-lesson");

      // DB: ghost lesson path unchanged (no filesystem representation)
      const updatedGhost = await getLesson(ghost1.id);
      expect(updatedGhost.path).toBe("ghost-lesson");

      // DB: section paths and order updated
      const updatedSection1 = await getSection(section1.id);
      expect(updatedSection1.path).toBe("02-intro");
      expect(updatedSection1.order).toBe(1);

      const updatedSection2 = await getSection(section2.id);
      expect(updatedSection2.path).toBe("01-advanced");
      expect(updatedSection2.order).toBe(0);
    });

    it("ghost-only section reorder: skips git mv for ghost section, renames real sections", async () => {
      const {
        run,
        createSection,
        createGhostSection,
        createRealLesson,
        createGhostLesson,
        getLesson,
        getSection,
      } = await setup();

      // Real section with a lesson on disk
      const section1 = await createSection("01-intro", 1);
      const lesson1 = await createRealLesson(
        section1.id,
        "01-intro",
        "01.01-first-lesson",
        1
      );

      // Ghost-only section (no directory on disk)
      const section2 = await createGhostSection("02-before-we-start", 2);
      const ghost = await createGhostLesson(
        section2.id,
        "Ghost Lesson",
        "ghost-lesson",
        1
      );

      // Reorder: ghost section first, real section second
      await run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.reorderSections([section2.id, section1.id]);
        })
      );

      // Real section directory renamed on disk
      expect(fs.existsSync(path.join(tempDir, "02-intro"))).toBe(true);
      expect(fs.existsSync(path.join(tempDir, "01-intro"))).toBe(false);

      // Real lesson path updated on disk
      expect(
        fs.existsSync(path.join(tempDir, "02-intro", "02.01-first-lesson"))
      ).toBe(true);

      // DB: section paths updated
      const updatedSection1 = await getSection(section1.id);
      expect(updatedSection1.path).toBe("02-intro");
      expect(updatedSection1.order).toBe(1);

      const updatedSection2 = await getSection(section2.id);
      expect(updatedSection2.path).toBe("01-before-we-start");
      expect(updatedSection2.order).toBe(0);

      // DB: real lesson path updated
      const updatedLesson = await getLesson(lesson1.id);
      expect(updatedLesson.path).toBe("02.01-first-lesson");

      // DB: ghost lesson path unchanged
      const updatedGhost = await getLesson(ghost.id);
      expect(updatedGhost.path).toBe("ghost-lesson");
    });
  });

  describe("end-to-end: create section → add ghost → materialize → rename", () => {
    it("full flow with slugified section path works without errors", async () => {
      const { run, createSection, getLesson } = await setup();

      // Create section with proper NN-slug path (as the fixed route now does)
      const section = await createSection("01-before-we-start", 1);

      // Add ghost lesson
      const ghostResult = await run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.addGhostLesson(section.id, "Where Were Going");
        })
      );
      expect(ghostResult.success).toBe(true);

      // Materialize ghost — files are auto-staged by createLessonDirectory
      const materializeResult = await run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.materializeGhost(ghostResult.lessonId);
        })
      );
      expect(materializeResult.path).toBe("01.01-where-were-going");

      // Rename lesson — works without manual git commit because files are staged
      const renameResult = await run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.renameLesson(
            ghostResult.lessonId,
            "where-we-are-going"
          );
        })
      );
      expect(renameResult.path).toBe("01.01-where-we-are-going");

      // Verify final state on disk
      expect(
        fs.existsSync(
          path.join(tempDir, "01-before-we-start", "01.01-where-we-are-going")
        )
      ).toBe(true);
      expect(
        fs.existsSync(
          path.join(tempDir, "01-before-we-start", "01.01-where-were-going")
        )
      ).toBe(false);

      // Verify DB state
      const updatedLesson = await getLesson(ghostResult.lessonId);
      expect(updatedLesson.path).toBe("01.01-where-we-are-going");
      expect(updatedLesson.fsStatus).toBe("real");
    });

    it("reorder ghost section first → materialize → rename works", async () => {
      const {
        run,
        createSection,
        createGhostSection,
        createRealLesson,
        getLesson,
        getSection,
      } = await setup();

      // Existing real section
      const section1 = await createSection("01-intro", 1);
      await createRealLesson(section1.id, "01-intro", "01.01-basics", 1);

      // New ghost-only section (no directory on disk)
      const section2 = await createGhostSection("02-before-we-start", 2);

      // Add ghost lesson to the ghost section
      const ghostResult = await run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.addGhostLesson(section2.id, "Where Were Going");
        })
      );

      // Reorder: ghost section first
      await run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.reorderSections([section2.id, section1.id]);
        })
      );

      // Verify ghost section DB path updated
      const reorderedSection2 = await getSection(section2.id);
      expect(reorderedSection2.path).toBe("01-before-we-start");

      // Materialize ghost lesson in the reordered section
      const materializeResult = await run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.materializeGhost(ghostResult.lessonId);
        })
      );
      expect(materializeResult.path).toBe("01.01-where-were-going");

      // Verify directory created at correct path
      expect(
        fs.existsSync(
          path.join(
            tempDir,
            "01-before-we-start",
            "01.01-where-were-going",
            "explainer",
            "readme.md"
          )
        )
      ).toBe(true);

      // Rename lesson — works without manual commit
      const renameResult = await run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.renameLesson(
            ghostResult.lessonId,
            "where-we-are-going"
          );
        })
      );
      expect(renameResult.path).toBe("01.01-where-we-are-going");

      // Verify final state
      expect(
        fs.existsSync(
          path.join(tempDir, "01-before-we-start", "01.01-where-we-are-going")
        )
      ).toBe(true);

      const updatedLesson = await getLesson(ghostResult.lessonId);
      expect(updatedLesson.path).toBe("01.01-where-we-are-going");
      expect(updatedLesson.fsStatus).toBe("real");
    });
  });

  describe("ghost section lifecycle", () => {
    it("materializing a ghost lesson in a ghost section slugifies the section path and creates the directory", async () => {
      const { run, createGhostSection, createGhostLesson, getSection } =
        await setup();

      const section = await createGhostSection("Before We Start", 1);
      const ghost = await createGhostLesson(
        section.id,
        "Where Were Going",
        "where-were-going",
        1
      );

      await run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.materializeGhost(ghost.id);
        })
      );

      const updatedSection = await getSection(section.id);
      expect(updatedSection.path).toBe("01-before-we-start");

      // Verify section directory was created on disk
      expect(fs.existsSync(path.join(tempDir, "01-before-we-start"))).toBe(
        true
      );

      // Verify lesson directory was created inside the slugified section
      expect(
        fs.existsSync(
          path.join(
            tempDir,
            "01-before-we-start",
            "01.01-where-were-going",
            "explainer"
          )
        )
      ).toBe(true);
    });

    it("materializing a ghost lesson in an already-real section does not change the section path", async () => {
      const {
        run,
        createSection,
        createRealLesson,
        createGhostLesson,
        getSection,
      } = await setup();

      const section = await createSection("01-intro", 1);
      await createRealLesson(section.id, "01-intro", "01.01-first-lesson", 1);
      const ghost = await createGhostLesson(
        section.id,
        "Second Lesson",
        "second-lesson",
        2
      );

      await run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.materializeGhost(ghost.id);
        })
      );

      const updatedSection = await getSection(section.id);
      expect(updatedSection.path).toBe("01-intro");
    });

    it("converting the last real lesson to ghost reverts section path to title case", async () => {
      const { run, createGhostSection, createGhostLesson, getSection } =
        await setup();

      const section = await createGhostSection("Before We Start", 1);
      const ghost = await createGhostLesson(
        section.id,
        "Where Were Going",
        "where-were-going",
        1
      );

      // Materialize the ghost lesson (which also materializes the section)
      await run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.materializeGhost(ghost.id);
        })
      );

      const realSection = await getSection(section.id);
      expect(realSection.path).toBe("01-before-we-start");

      // Convert the lesson back to ghost
      await run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.convertToGhost(ghost.id);
        })
      );

      const ghostSection = await getSection(section.id);
      expect(ghostSection.path).toBe("Before We Start");
    });

    it("addGhostSection creates a section with the raw title as its path", async () => {
      const { run, repoVersionId, getSection } = await setup();

      const result = await run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.addGhostSection(
            repoVersionId,
            "Before We Start"
          );
        })
      );

      expect(result.success).toBe(true);
      const section = await getSection(result.sectionId);
      expect(section.path).toBe("Before We Start");
    });

    it("converting a real lesson when other real lessons remain does not change the section path", async () => {
      const { run, createSection, createRealLesson, getSection } =
        await setup();

      const section = await createSection("01-intro", 1);
      const lesson1 = await createRealLesson(
        section.id,
        "01-intro",
        "01.01-first-lesson",
        1
      );
      await createRealLesson(section.id, "01-intro", "01.02-second-lesson", 2);

      await run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.convertToGhost(lesson1.id);
        })
      );

      const updatedSection = await getSection(section.id);
      expect(updatedSection.path).toBe("01-intro");
    });

    it("dematerializing a section renumbers remaining real sections and their lessons", async () => {
      const {
        run,
        createGhostSection,
        createSection,
        createRealLesson,
        createGhostLesson,
        getLesson,
        getSection,
      } = await setup();

      // Ghost section → materialize → then dematerialize
      const section1 = await createGhostSection("Before We Start", 1);
      const section2 = await createSection("02-intro", 2);
      const lesson2 = await createRealLesson(
        section2.id,
        "02-intro",
        "02.01-basics",
        1
      );

      // Materialize ghost section by adding and materializing a lesson
      const ghost = await createGhostLesson(
        section1.id,
        "Where Were Going",
        "where-were-going",
        1
      );

      await run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.materializeGhost(ghost.id);
        })
      );

      // After materialize: 01-before-we-start, 02-intro
      const materializedSection = await getSection(section1.id);
      expect(materializedSection.path).toBe("01-before-we-start");

      // Convert the lesson back to ghost → section dematerializes
      await run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.convertToGhost(ghost.id);
        })
      );

      // Section reverted to ghost
      const ghostSection = await getSection(section1.id);
      expect(ghostSection.path).toBe("Before We Start");

      // Other section renumbered: 02-intro → 01-intro
      const updatedSection2 = await getSection(section2.id);
      expect(updatedSection2.path).toBe("01-intro");

      // Lesson within renumbered section also updated
      const updatedLesson2 = await getLesson(lesson2.id);
      expect(updatedLesson2.path).toBe("01.01-basics");

      // Verify filesystem
      expect(
        fs.existsSync(path.join(tempDir, "01-intro", "01.01-basics"))
      ).toBe(true);
      expect(fs.existsSync(path.join(tempDir, "02-intro"))).toBe(false);
    });
  });

  describe("materializeGhost renumbering", () => {
    it("materializing a ghost section in the middle renumbers other sections", async () => {
      const {
        run,
        createSection,
        createGhostSection,
        createRealLesson,
        createGhostLesson,
        getLesson,
        getSection,
      } = await setup();

      const section1 = await createSection("01-intro", 1);
      const lesson1 = await createRealLesson(
        section1.id,
        "01-intro",
        "01.01-basics",
        1
      );

      // Ghost section in the middle (order 2)
      const section2 = await createGhostSection("Middle Section", 2);

      const section3 = await createSection("02-advanced", 3);
      const lesson3 = await createRealLesson(
        section3.id,
        "02-advanced",
        "02.01-deep-dive",
        1
      );

      // Add and materialize ghost lesson → ghost section materializes
      const ghost = await createGhostLesson(section2.id, "Setup", "setup", 1);

      await run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.materializeGhost(ghost.id);
        })
      );

      // Ghost section materialized at position 2
      const updatedSection2 = await getSection(section2.id);
      expect(updatedSection2.path).toBe("02-middle-section");

      // First section unchanged (already 01)
      const updatedSection1 = await getSection(section1.id);
      expect(updatedSection1.path).toBe("01-intro");

      // Third section renumbered: 02-advanced → 03-advanced
      const updatedSection3 = await getSection(section3.id);
      expect(updatedSection3.path).toBe("03-advanced");

      // Lesson in third section renumbered
      const updatedLesson3 = await getLesson(lesson3.id);
      expect(updatedLesson3.path).toBe("03.01-deep-dive");

      // Lesson in first section unchanged
      const updatedLesson1 = await getLesson(lesson1.id);
      expect(updatedLesson1.path).toBe("01.01-basics");

      // Verify filesystem
      expect(
        fs.existsSync(path.join(tempDir, "02-middle-section", "02.01-setup"))
      ).toBe(true);
      expect(
        fs.existsSync(path.join(tempDir, "03-advanced", "03.01-deep-dive"))
      ).toBe(true);
      expect(fs.existsSync(path.join(tempDir, "02-advanced"))).toBe(false);
    });

    it("materializing a ghost section at the start renumbers all other sections and lessons", async () => {
      const {
        run,
        createSection,
        createGhostSection,
        createRealLesson,
        createGhostLesson,
        getLesson,
        getSection,
      } = await setup();

      // Ghost section at order 1 (first position)
      const section1 = await createGhostSection("Before We Start", 1);

      const section2 = await createSection("01-intro", 2);
      const lesson2 = await createRealLesson(
        section2.id,
        "01-intro",
        "01.01-basics",
        1
      );

      const section3 = await createSection("02-advanced", 3);
      const lesson3 = await createRealLesson(
        section3.id,
        "02-advanced",
        "02.01-deep-dive",
        1
      );

      // Add and materialize ghost lesson
      const ghost = await createGhostLesson(
        section1.id,
        "Where Were Going",
        "where-were-going",
        1
      );

      await run(
        Effect.gen(function* () {
          const service = yield* CourseWriteService;
          return yield* service.materializeGhost(ghost.id);
        })
      );

      // Ghost section materialized at position 1
      const updatedSection1 = await getSection(section1.id);
      expect(updatedSection1.path).toBe("01-before-we-start");

      // Other sections renumbered
      const updatedSection2 = await getSection(section2.id);
      expect(updatedSection2.path).toBe("02-intro");

      const updatedSection3 = await getSection(section3.id);
      expect(updatedSection3.path).toBe("03-advanced");

      // Lessons renumbered
      const updatedLesson2 = await getLesson(lesson2.id);
      expect(updatedLesson2.path).toBe("02.01-basics");

      const updatedLesson3 = await getLesson(lesson3.id);
      expect(updatedLesson3.path).toBe("03.01-deep-dive");

      // Verify filesystem
      expect(
        fs.existsSync(
          path.join(tempDir, "01-before-we-start", "01.01-where-were-going")
        )
      ).toBe(true);
      expect(
        fs.existsSync(path.join(tempDir, "02-intro", "02.01-basics"))
      ).toBe(true);
      expect(
        fs.existsSync(path.join(tempDir, "03-advanced", "03.01-deep-dive"))
      ).toBe(true);
      expect(fs.existsSync(path.join(tempDir, "01-intro"))).toBe(false);
      expect(fs.existsSync(path.join(tempDir, "02-advanced"))).toBe(false);
    });
  });
});
