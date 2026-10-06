import { describe, it, expect } from "@effect/vitest";
import { beforeAll, beforeEach } from "vitest";
import { Effect, Layer } from "effect";
import { VideoOperationsService } from "./db-video-operations.server.js";
import { CourseOperationsService } from "./db-course-operations.server.js";
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
// `deleteVideo` — the Video soft delete behind both the UI's delete-video
// modal and `cvm video archive`.
//
// The CLI verb pre-reads the row (so it can answer a not-found itself), which
// means its NotFoundError branch is only ever reachable through the OTHER
// caller — the /api/videos/delete action. These tests cover the service
// directly, which is where that behaviour actually lives.
// ===========================================================================

let testDb: TestDb;
let testLayer: Layer.Layer<VideoOperationsService>;

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;

  const drizzleLayer = Layer.succeed(DrizzleService, testDb as any);
  testLayer = VideoOperationsService.Default.pipe(
    Layer.provide(
      CourseOperationsService.Default.pipe(Layer.provide(drizzleLayer))
    ),
    Layer.provide(drizzleLayer)
  );
});

beforeEach(async () => {
  await truncateAllTables(testDb);
});

describe("deleteVideo", () => {
  it.effect("archives the video and returns the archived row", () =>
    Effect.gen(function* () {
      const videoOps = yield* VideoOperationsService;
      const video = yield* videoOps.createStandaloneVideo({
        title: "Doomed",
        format: "landscape",
      });

      const archived = yield* videoOps.deleteVideo(video.id);

      expect(archived.id).toBe(video.id);
      expect(archived.archived).toBe(true);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("fails with NotFoundError for an id that is not there", () =>
    Effect.gen(function* () {
      const videoOps = yield* VideoOperationsService;

      const error = yield* Effect.flip(videoOps.deleteVideo("vid_nope"));

      expect(error._tag).toBe("NotFoundError");
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("carries no message, so the route renders its own 404 text", () =>
    Effect.gen(function* () {
      const videoOps = yield* VideoOperationsService;

      const error = yield* Effect.flip(videoOps.deleteVideo("vid_nope"));

      // /api/videos/delete maps this tag to 404. route-action.server.ts
      // surfaces a mapped error's own `message` to the browser when it is a
      // non-empty string, and falls back to "Not found" otherwise — an id is
      // user input, so it must take the fallback rather than echo internals.
      expect(
        "message" in error && typeof error.message === "string"
          ? error.message
          : ""
      ).toBe("");
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("is idempotent — re-archiving an archived video succeeds", () =>
    Effect.gen(function* () {
      const videoOps = yield* VideoOperationsService;
      const video = yield* videoOps.createStandaloneVideo({
        title: "Doomed",
        format: "landscape",
      });

      yield* videoOps.deleteVideo(video.id);
      // The UI's delete modal can post the same id twice (a double submit).
      // The row still matches the UPDATE's WHERE once archived, so the second
      // write echoes it rather than turning into a spurious 404.
      const again = yield* videoOps.deleteVideo(video.id);

      expect(again.id).toBe(video.id);
      expect(again.archived).toBe(true);
    }).pipe(Effect.provide(testLayer))
  );
});

describe("unarchiveVideo", () => {
  it.effect(
    "returns a Video to its Lesson, or to Standalone when that Lesson is archived",
    () =>
      Effect.gen(function* () {
        const [course] = yield* Effect.promise(() =>
          testDb.insert(courses).values({ name: "course" }).returning()
        );
        const [version] = yield* Effect.promise(() =>
          testDb
            .insert(courseVersions)
            .values({ repoId: course!.id, name: "v1" })
            .returning()
        );
        yield* Effect.promise(() =>
          testDb
            .insert(sections)
            .values({ id: "section", repoVersionId: version!.id, order: 1 })
        );
        yield* Effect.promise(() =>
          testDb.insert(lessons).values([
            { id: "lesson-live", sectionId: "section", order: 1 },
            {
              id: "lesson-gone",
              sectionId: "section",
              order: 2,
              archived: true,
            },
          ])
        );
        yield* Effect.promise(() =>
          testDb.insert(videos).values([
            {
              id: "video-home",
              lessonId: "lesson-live",
              title: "a.mp4",
              originalFootagePath: "/a",
              archived: true,
            },
            {
              id: "video-orphan",
              lessonId: "lesson-gone",
              title: "b.mp4",
              originalFootagePath: "/b",
              archived: true,
            },
          ])
        );
        const videoOps = yield* VideoOperationsService;

        const home = yield* videoOps.unarchiveVideo("video-home");
        const orphan = yield* videoOps.unarchiveVideo("video-orphan");

        expect(home).toMatchObject({
          archived: false,
          lessonId: "lesson-live",
        });
        expect(orphan).toMatchObject({ archived: false, lessonId: null });
      }).pipe(Effect.provide(testLayer))
  );
});
