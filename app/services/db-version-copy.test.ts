import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { Effect, Layer } from "effect";
import { DBFunctionsService } from "@/services/db-service.server";
import { DrizzleService } from "@/services/drizzle-service.server";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/pglite";
import * as schema from "@/db/schema";

let testDb: TestDb;
let testLayer: Layer.Layer<DBFunctionsService>;

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;
  testLayer = DBFunctionsService.Default.pipe(
    Layer.provide(Layer.succeed(DrizzleService, testDb as any))
  );
});

beforeEach(async () => {
  await truncateAllTables(testDb);
});

const run = <A, E>(eff: Effect.Effect<A, E, DBFunctionsService>) =>
  Effect.runPromise(eff.pipe(Effect.provide(testLayer)));

describe("copyVersionStructure", () => {
  it("preserves lesson icon (type) when copying a version", async () => {
    const [course] = await testDb
      .insert(schema.courses)
      .values({ name: "Test Course", filePath: "/tmp/test" })
      .returning();

    const [version] = await testDb
      .insert(schema.courseVersions)
      .values({ repoId: course!.id, name: "v1" })
      .returning();

    const [section] = await testDb
      .insert(schema.sections)
      .values({ repoVersionId: version!.id, path: "01-intro", order: 1 })
      .returning();

    await testDb.insert(schema.lessons).values({
      sectionId: section!.id,
      path: "01-intro/01-lesson",
      order: 1,
      icon: "code",
      fsStatus: "real",
      title: "Test Lesson",
    });

    const result = await run(
      Effect.gen(function* () {
        const db = yield* DBFunctionsService;
        return yield* db.copyVersionStructure({
          sourceVersionId: version!.id,
          repoId: course!.id,
          newVersionName: "v2",
        });
      })
    );

    const newSections = await testDb.query.sections.findMany({
      where: (s, { eq }) => eq(s.repoVersionId, result.version.id),
      with: { lessons: true },
    });

    expect(newSections).toHaveLength(1);
    expect(newSections[0]!.lessons).toHaveLength(1);
    expect(newSections[0]!.lessons[0]!.icon).toBe("code");
  });

  it("preserves section description when copying a version", async () => {
    const [course] = await testDb
      .insert(schema.courses)
      .values({ name: "Test Course 2", filePath: "/tmp/test2" })
      .returning();

    const [version] = await testDb
      .insert(schema.courseVersions)
      .values({ repoId: course!.id, name: "v1" })
      .returning();

    await testDb.insert(schema.sections).values({
      repoVersionId: version!.id,
      path: "01-intro",
      order: 1,
      description: "This is a section description",
    });

    const result = await run(
      Effect.gen(function* () {
        const db = yield* DBFunctionsService;
        return yield* db.copyVersionStructure({
          sourceVersionId: version!.id,
          repoId: course!.id,
          newVersionName: "v2",
        });
      })
    );

    const newSections = await testDb.query.sections.findMany({
      where: (s, { eq }) => eq(s.repoVersionId, result.version.id),
    });

    expect(newSections).toHaveLength(1);
    expect(newSections[0]!.description).toBe("This is a section description");
  });

  it("preserves lesson fsStatus (ghost/real) when copying a version", async () => {
    const [course] = await testDb
      .insert(schema.courses)
      .values({ name: "Test Course 3", filePath: "/tmp/test3" })
      .returning();

    const [version] = await testDb
      .insert(schema.courseVersions)
      .values({ repoId: course!.id, name: "v1" })
      .returning();

    const [section] = await testDb
      .insert(schema.sections)
      .values({ repoVersionId: version!.id, path: "01-intro", order: 1 })
      .returning();

    await testDb.insert(schema.lessons).values([
      {
        sectionId: section!.id,
        path: "01-intro/01-lesson",
        order: 1,
        fsStatus: "real",
        title: "Real Lesson",
      },
      {
        sectionId: section!.id,
        path: "01-intro/02-ghost",
        order: 2,
        fsStatus: "ghost",
        title: "Ghost Lesson",
      },
    ]);

    const result = await run(
      Effect.gen(function* () {
        const db = yield* DBFunctionsService;
        return yield* db.copyVersionStructure({
          sourceVersionId: version!.id,
          repoId: course!.id,
          newVersionName: "v2",
        });
      })
    );

    const newSections = await testDb.query.sections.findMany({
      where: (s, { eq }) => eq(s.repoVersionId, result.version.id),
      with: { lessons: { orderBy: (l, { asc }) => asc(l.order) } },
    });

    expect(newSections[0]!.lessons[0]!.fsStatus).toBe("real");
    expect(newSections[0]!.lessons[1]!.fsStatus).toBe("ghost");
  });
});
