import { describe, it, expect } from "@effect/vitest";
import { beforeAll, beforeEach } from "vitest";
import { Effect, Layer } from "effect";
import { eq } from "drizzle-orm";
import { LessonSectionOperationsService } from "./db-lesson-section-operations.server.js";
import { DrizzleService } from "./drizzle-service.server.js";
import {
  courses,
  courseVersions,
  lessons,
  sections,
  videos,
} from "../db/schema.js";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "../test-utils/pglite.js";

// ===========================================================================
// `unarchiveLesson` — the undo of `deleteLesson` (the Lesson Archive), behind
// the Archived Lessons page and `cvm lesson unarchive`.
// ===========================================================================

let testDb: TestDb;
let testLayer: Layer.Layer<LessonSectionOperationsService>;

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;
  testLayer = LessonSectionOperationsService.Default.pipe(
    Layer.provide(Layer.succeed(DrizzleService, testDb as any))
  );
});

beforeEach(async () => {
  await truncateAllTables(testDb);
});

/** A Section of three Lessons (a, b, c at orders 0..2); b holds a Video. */
const seed = (commitState: "draft" | "published" = "draft") =>
  Effect.promise(async () => {
    const [course] = await testDb
      .insert(courses)
      .values({ name: "course" })
      .returning();
    const [version] = await testDb
      .insert(courseVersions)
      .values({ repoId: course!.id, name: "v1", commitState })
      .returning();
    await testDb
      .insert(sections)
      .values({ id: "section", repoVersionId: version!.id, order: 0 });
    await testDb.insert(lessons).values([
      { id: "a", sectionId: "section", title: "a", order: 0 },
      { id: "b", sectionId: "section", title: "b", order: 1 },
      { id: "c", sectionId: "section", title: "c", order: 2 },
    ]);
    await testDb.insert(videos).values({
      id: "video",
      lessonId: "b",
      title: "b.mp4",
      originalFootagePath: "/b",
    });
    return version!.id;
  });

const hasChanges = (versionId: string) =>
  Effect.promise(async () => {
    const [row] = await testDb
      .select({ hasChanges: courseVersions.hasChanges })
      .from(courseVersions)
      .where(eq(courseVersions.id, versionId));
    return row!.hasChanges;
  });

describe("unarchiveLesson", () => {
  it.effect(
    "archive then unarchive leaves the Lesson, its slot and its Videos as before",
    () =>
      Effect.gen(function* () {
        const versionId = yield* seed();
        const ops = yield* LessonSectionOperationsService;
        const before = yield* ops.getLessonById("b");

        yield* ops.deleteLesson("b");
        expect(yield* ops.getArchivedLessonsBySectionId("section")).toEqual([
          expect.objectContaining({ id: "b", archived: true }),
        ]);

        yield* ops.unarchiveLesson("b");

        expect(yield* ops.getLessonById("b")).toEqual(before);
        expect(
          (yield* ops.getLessonsBySectionId("section")).map((l) => l.id)
        ).toEqual(["a", "b", "c"]);
        expect(yield* ops.getArchivedLessonsBySectionId("section")).toEqual([]);
        expect(yield* hasChanges(versionId)).toBe(true);
      }).pipe(Effect.provide(testLayer))
  );

  it.effect("goes to the end of its Section when its slot was taken", () =>
    Effect.gen(function* () {
      yield* seed();
      const ops = yield* LessonSectionOperationsService;

      yield* ops.deleteLesson("b");
      // A reorder renumbers the live Lessons, so c now holds b's old order.
      yield* ops.batchUpdateLessonOrders([
        { id: "a", order: 0 },
        { id: "c", order: 1 },
      ]);
      yield* ops.unarchiveLesson("b");

      expect(
        (yield* ops.getLessonsBySectionId("section")).map((l) => l.id)
      ).toEqual(["a", "c", "b"]);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("is refused when a live sibling has taken its title", () =>
    Effect.gen(function* () {
      yield* seed();
      const ops = yield* LessonSectionOperationsService;

      yield* ops.deleteLesson("b");
      yield* ops.updateLesson("c", { title: "b" });
      const error = yield* Effect.flip(ops.unarchiveLesson("b"));

      expect(error._tag).toBe("LessonPathTakenError");
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("is refused when its Section has been archived", () =>
    Effect.gen(function* () {
      yield* seed();
      const ops = yield* LessonSectionOperationsService;

      yield* ops.deleteLesson("b");
      yield* ops.archiveSection("section");
      const error = yield* Effect.flip(ops.unarchiveLesson("b"));

      expect(error._tag).toBe("NotFoundError");
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("cannot touch a Lesson of a Published Version", () =>
    Effect.gen(function* () {
      yield* seed("published");
      yield* Effect.promise(() =>
        testDb
          .update(lessons)
          .set({ archived: true })
          .where(eq(lessons.id, "b"))
      );
      const ops = yield* LessonSectionOperationsService;

      const error = yield* Effect.flip(ops.unarchiveLesson("b"));

      expect(error._tag).toBe("VersionNotDraftError");
    }).pipe(Effect.provide(testLayer))
  );
});
