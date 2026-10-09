import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { Effect, Layer } from "effect";
import { sql } from "drizzle-orm";
import { CourseOperationsService } from "./db-course-operations.server.js";
import { DrizzleService } from "./drizzle-service.server.js";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "../test-utils/pglite.js";
import * as schema from "../db/schema.js";

/**
 * A duplicate that dies part-way must leave no half-copied Course behind:
 * the route refuses a second duplicate under a name that is already taken, so
 * a leftover Course turns a retry into a hand clean-up. Its own file because
 * `db-duplicate-course.test.ts` is at the file-token cap.
 */

let testDb: TestDb;
let testLayer: Layer.Layer<CourseOperationsService>;

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;
  testLayer = CourseOperationsService.Default.pipe(
    Layer.provide(Layer.succeed(DrizzleService, testDb as any))
  );
});

beforeEach(async () => {
  await truncateAllTables(testDb);
});

const run = <A, E>(eff: Effect.Effect<A, E, CourseOperationsService>) =>
  Effect.runPromise(eff.pipe(Effect.provide(testLayer)));

const THUMBNAIL = `"course-video-manager_thumbnail"`;

describe("duplicateCourse atomicity", () => {
  it("leaves no Course behind when a write fails mid-copy, so a retry works", async () => {
    const [course] = await testDb
      .insert(schema.courses)
      .values({ name: "Original Course" })
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
      .values({ sectionId: section!.id, order: 1, title: "Lesson" })
      .returning();
    const [video] = await testDb
      .insert(schema.videos)
      .values({
        lessonId: lesson!.id,
        title: "video-01.mp4",
        originalFootagePath: "/footage/raw-01.mp4",
      })
      .returning();
    await testDb.insert(schema.thumbnails).values({
      videoId: video!.id,
      layers: "[]",
      filePath: null,
      selectedForUpload: false,
    });

    // Every row before the Thumbnails lands; the Thumbnail insert then fails.
    await testDb.execute(
      sql.raw(`CREATE FUNCTION fail_thumbnail_insert() RETURNS trigger AS $$
        BEGIN RAISE EXCEPTION 'injected failure'; END $$ LANGUAGE plpgsql`)
    );
    await testDb.execute(
      sql.raw(`CREATE TRIGGER fail_thumbnail_insert BEFORE INSERT ON ${THUMBNAIL}
        FOR EACH ROW EXECUTE FUNCTION fail_thumbnail_insert()`)
    );

    try {
      await expect(
        run(
          Effect.gen(function* () {
            const ops = yield* CourseOperationsService;
            return yield* ops.duplicateCourse({
              sourceCourseId: course!.id,
              name: "Copy",
            });
          })
        )
      ).rejects.toThrow();

      const names = (await testDb.select().from(schema.courses)).map(
        (c) => c.name
      );
      expect(names).toEqual(["Original Course"]);
      expect(await testDb.select().from(schema.videos)).toHaveLength(1);
    } finally {
      await testDb.execute(
        sql.raw(`DROP TRIGGER fail_thumbnail_insert ON ${THUMBNAIL}`)
      );
      await testDb.execute(sql.raw(`DROP FUNCTION fail_thumbnail_insert()`));
    }

    const retried = await run(
      Effect.gen(function* () {
        const ops = yield* CourseOperationsService;
        return yield* ops.duplicateCourse({
          sourceCourseId: course!.id,
          name: "Copy",
        });
      })
    );
    expect(retried.course.name).toBe("Copy");
    expect(retried.videoLineageMappings).toHaveLength(1);
  });
});
