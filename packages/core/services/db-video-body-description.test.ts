import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { Effect, Layer } from "effect";
import { VideoOperationsService } from "./db-video-operations.server.js";
import { CourseOperationsService } from "./db-course-operations.server.js";
import { DrizzleService } from "./drizzle-service.server.js";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "../test-utils/pglite.js";
import * as schema from "../db/schema.js";

let testDb: TestDb;
let testLayer: Layer.Layer<VideoOperationsService>;

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;
  const drizzle = Layer.succeed(DrizzleService, testDb as any);
  testLayer = VideoOperationsService.Default.pipe(
    Layer.provide(CourseOperationsService.Default),
    Layer.provide(drizzle)
  );
});

beforeEach(async () => {
  await truncateAllTables(testDb);
});

async function seedVideo() {
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
  return {
    course: course!,
    version: version!,
    section: section!,
    lesson: lesson!,
    video: video!,
  };
}

const run = <A, E>(eff: Effect.Effect<A, E, VideoOperationsService>) =>
  Effect.runPromise(eff.pipe(Effect.provide(testLayer)));

describe("updateVideoBody", () => {
  it("persists a markdown body on a video", async () => {
    const { video } = await seedVideo();

    const updated = await run(
      Effect.gen(function* () {
        const ops = yield* VideoOperationsService;
        return yield* ops.updateVideoBody({
          videoId: video.id,
          body: "# Hello World\n\nThis is the body.",
        });
      })
    );

    expect(updated.body).toBe("# Hello World\n\nThis is the body.");
  });
});
