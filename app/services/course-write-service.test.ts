import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "@/db/schema";
import { describe, it, expect, afterEach } from "vitest";
import { Effect, Layer } from "effect";
import { pushSchema } from "drizzle-kit/api";
import { DBFunctionsService } from "@/services/db-service.server";
import { DrizzleService } from "@/services/drizzle-service.server";
import { CourseWriteService } from "@/services/course-write-service";
import { NodeContext } from "@effect/platform-node";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";

let tempDir: string;

const setupTempGitRepo = () => {
  tempDir = fs.mkdtempSync(path.join(tmpdir(), "course-write-test-"));
  execSync("git init", { cwd: tempDir });
  execSync('git config user.email "test@test.com"', { cwd: tempDir });
  execSync('git config user.name "Test"', { cwd: tempDir });
  fs.writeFileSync(path.join(tempDir, ".gitkeep"), "");
  execSync("git add . && git commit -m 'init'", { cwd: tempDir });
};

/**
 * Creates test infrastructure: PGlite DB + temp git repo + composed layer.
 * Returns seed helpers and a run function for executing effects.
 */
const setup = async () => {
  setupTempGitRepo();

  const pglite = new PGlite();
  const testDb = drizzle(pglite, { schema });
  const { apply } = await pushSchema(schema, testDb as any);
  await apply();

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

  const getLesson = (lessonId: string) =>
    Effect.gen(function* () {
      const db = yield* DBFunctionsService;
      return yield* db.getLessonWithHierarchyById(lessonId);
    }).pipe(Effect.provide(dbLayer), Effect.runPromise);

  return {
    run,
    createSection,
    createRealLesson,
    createGhostLesson,
    getLesson,
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
});
