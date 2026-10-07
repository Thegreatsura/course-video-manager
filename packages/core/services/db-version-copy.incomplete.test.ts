import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { Effect, Layer } from "effect";
import { sql } from "drizzle-orm";
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
  testDb = (await createTestDb()).testDb;
  testLayer = VersionOperationsService.Default.pipe(
    Layer.provide(Layer.succeed(DrizzleService, testDb as any))
  );
});

beforeEach(async () => {
  await truncateAllTables(testDb);
});

const OVERLAY = sql.raw(`"course-video-manager_overlay"`);

afterEach(async () => {
  await testDb.execute(
    sql`DROP TRIGGER IF EXISTS swallow_insert ON ${OVERLAY}`
  );
});

/**
 * Stands in for a copy-path bug at the database: from now on every Overlay
 * insert is silently dropped, exactly as if the copy had forgotten the table.
 */
const loseEveryOverlayInsert = async () => {
  await testDb.execute(
    sql`CREATE OR REPLACE FUNCTION swallow_row() RETURNS trigger AS $$ BEGIN RETURN NULL; END $$ LANGUAGE plpgsql`
  );
  await testDb.execute(
    sql`CREATE TRIGGER swallow_insert BEFORE INSERT ON ${OVERLAY} FOR EACH ROW EXECUTE FUNCTION swallow_row()`
  );
};

describe("Submit refuses a copy that leaves a table short", () => {
  it("fails with VersionCopyIncompleteError and rolls the whole Submit back", async () => {
    const [course] = await testDb
      .insert(schema.courses)
      .values({ name: "Course" })
      .returning();
    const [version] = await testDb
      .insert(schema.courseVersions)
      .values({ repoId: course!.id, name: "v1" })
      .returning();
    const [section] = await testDb
      .insert(schema.sections)
      .values({ repoVersionId: version!.id, title: "S", order: 1 })
      .returning();
    const [lesson] = await testDb
      .insert(schema.lessons)
      .values({ sectionId: section!.id, title: "L", order: 1 })
      .returning();
    const [video] = await testDb
      .insert(schema.videos)
      .values({
        lessonId: lesson!.id,
        title: "v.mp4",
        originalFootagePath: "/f",
      })
      .returning();
    const [clip] = await testDb
      .insert(schema.clips)
      .values({
        videoId: video!.id,
        videoFilename: "take.mp4",
        sourceStartTime: 0,
        sourceEndTime: 5,
        order: "a0",
        text: "",
      })
      .returning();
    await testDb.insert(schema.overlays).values({
      clipId: clip!.id,
      at: 0,
      durationInSeconds: 2,
      title: "Term",
      description: "Definition",
    });
    await loseEveryOverlayInsert();

    const error = await Effect.runPromise(
      Effect.gen(function* () {
        const versionOps = yield* VersionOperationsService;
        return yield* versionOps.freezeAndCloneVersion({
          sourceVersionId: version!.id,
          repoId: course!.id,
          sourceName: "v1",
          sourceDescription: "",
        });
      }).pipe(Effect.flip, Effect.provide(testLayer))
    );

    expect(error).toMatchObject({
      _tag: "VersionCopyIncompleteError",
      table: "overlay",
      sourceCount: 1,
      copyCount: 0,
    });
    expect(error.message).toContain('"overlay"');
    // Rolled back: still one Version, still a Draft, nothing copied.
    const versions = await testDb.query.courseVersions.findMany();
    expect(versions.map((v) => [v.id, v.commitState, v.name])).toEqual([
      [version!.id, "draft", "v1"],
    ]);
    expect(await testDb.query.clips.findMany()).toHaveLength(1);
  });
});
