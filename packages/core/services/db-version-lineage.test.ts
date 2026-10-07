import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { Effect, Layer } from "effect";
import { VersionOperationsService } from "./db-version-operations.server.js";
import { DrizzleService } from "./drizzle-service.server.js";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "../test-utils/pglite.js";
import * as schema from "../db/schema.js";

let testDb: TestDb;
let testLayer: Layer.Layer<VersionOperationsService>;

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;
  testLayer = VersionOperationsService.Default.pipe(
    Layer.provide(Layer.succeed(DrizzleService, testDb as any))
  );
});

beforeEach(async () => {
  await truncateAllTables(testDb);
});

const run = <A, E>(eff: Effect.Effect<A, E, VersionOperationsService>) =>
  Effect.runPromise(eff.pipe(Effect.provide(testLayer)));

describe("lineageId copy-forward", () => {
  it("copies lineageId forward unchanged at every level, onto new rows", async () => {
    const [course] = await testDb
      .insert(schema.courses)
      .values({ name: "Test" })
      .returning();

    const [version] = await testDb
      .insert(schema.courseVersions)
      .values({ repoId: course!.id, name: "v1" })
      .returning();

    const [section] = await testDb
      .insert(schema.sections)
      .values({ repoVersionId: version!.id, title: "01-intro", order: 1 })
      .returning();

    const [lesson] = await testDb
      .insert(schema.lessons)
      .values({
        sectionId: section!.id,
        order: 1,
        title: "Lesson",
        authoringStatus: "done",
      })
      .returning();

    const [video] = await testDb
      .insert(schema.videos)
      .values({
        lessonId: lesson!.id,
        title: "explainer",
        originalFootagePath: "/footage/v1",
      })
      .returning();

    const result = await run(
      Effect.gen(function* () {
        const ops = yield* VersionOperationsService;
        return yield* ops.copyVersionStructure({
          sourceVersionId: version!.id,
          repoId: course!.id,
          newVersionName: "v2",
        });
      })
    );

    const newSections = await testDb.query.sections.findMany({
      where: (s, { eq }) => eq(s.repoVersionId, result.version.id),
      with: { lessons: { with: { videos: true } } },
    });
    const newSection = newSections[0]!;
    const newLesson = newSection.lessons[0]!;
    const newVideo = newLesson.videos[0]!;

    expect(newSection.lineageId).toBe(section!.lineageId);
    expect(newSection.id).not.toBe(section!.id);
    expect(newLesson.lineageId).toBe(lesson!.lineageId);
    expect(newLesson.id).not.toBe(lesson!.id);
    expect(newVideo.lineageId).toBe(video!.lineageId);
    expect(newVideo.id).not.toBe(video!.id);
  });

  it("assigns fresh lineageId to genuinely new rows", async () => {
    const [course] = await testDb
      .insert(schema.courses)
      .values({ name: "Test" })
      .returning();

    const [version] = await testDb
      .insert(schema.courseVersions)
      .values({ repoId: course!.id, name: "v1" })
      .returning();

    const [s1] = await testDb
      .insert(schema.sections)
      .values({ repoVersionId: version!.id, title: "01-intro", order: 1 })
      .returning();

    const [s2] = await testDb
      .insert(schema.sections)
      .values({ repoVersionId: version!.id, title: "02-advanced", order: 2 })
      .returning();

    expect(s1!.lineageId).toBeTruthy();
    expect(s2!.lineageId).toBeTruthy();
    expect(s1!.lineageId).not.toBe(s2!.lineageId);
  });
});
