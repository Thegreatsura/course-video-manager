import { describe, it, expect } from "@effect/vitest";
import { beforeAll, beforeEach } from "vitest";
import { Effect, Layer } from "effect";
import { VideoOperationsService } from "./db-video-operations.server.js";
import { DrizzleService } from "./drizzle-service.server.js";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "../test-utils/test-db.js";
import * as schema from "../db/schema.js";

let testDb: TestDb;
let testLayer: Layer.Layer<VideoOperationsService>;

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;
  testLayer = VideoOperationsService.Default.pipe(
    Layer.provide(Layer.succeed(DrizzleService, testDb as any))
  );
});

beforeEach(async () => {
  await truncateAllTables(testDb);
});

type VideoDef = {
  title: string;
  body?: string | null;
  clips?: number;
  archivedClips?: number;
  archived?: boolean;
};

/** One Course Version; returns every Video's id by title. */
const buildCourse = async (
  versionName: string,
  courseId: string | null,
  sections: Array<{
    order: number;
    archived?: boolean;
    lessons: Array<{ order: number; archived?: boolean; videos: VideoDef[] }>;
  }>
) => {
  const repoId =
    courseId ??
    (
      await testDb
        .insert(schema.courses)
        .values({ name: "Test Course" })
        .returning()
    )[0]!.id;
  const [version] = await testDb
    .insert(schema.courseVersions)
    .values({ repoId, name: versionName })
    .returning();

  const ids: Record<string, string> = {};
  for (const s of sections) {
    const [section] = await testDb
      .insert(schema.sections)
      .values({
        repoVersionId: version!.id,
        title: `S${s.order}`,
        order: s.order,
        archivedAt: s.archived ? new Date() : null,
      })
      .returning();
    for (const l of s.lessons) {
      const [lesson] = await testDb
        .insert(schema.lessons)
        .values({
          sectionId: section!.id,
          title: `L${s.order}.${l.order}`,
          order: l.order,
          archived: l.archived ?? false,
        })
        .returning();
      for (const v of l.videos) {
        const [video] = await testDb
          .insert(schema.videos)
          .values({
            lessonId: lesson!.id,
            title: v.title,
            originalFootagePath: v.title,
            body: v.body ?? null,
            archived: v.archived ?? false,
          })
          .returning();
        ids[v.title] = video!.id;
        const clipCount = (v.clips ?? 0) + (v.archivedClips ?? 0);
        for (let i = 0; i < clipCount; i++) {
          await testDb.insert(schema.clips).values({
            videoId: video!.id,
            videoFilename: "f.mp4",
            sourceStartTime: 0,
            sourceEndTime: 1,
            order: `a${i}`,
            text: "",
            archived: i >= (v.clips ?? 0),
          });
        }
      }
    }
  }
  return { repoId, ids };
};

const findNext = (videoId: string) =>
  Effect.gen(function* () {
    const ops = yield* VideoOperationsService;
    return yield* ops.getNextVideoNeedingBody(videoId);
  }).pipe(Effect.provide(testLayer));

describe("getNextVideoNeedingBody", () => {
  it.effect(
    "walks forward in course order to the next live Video with Clips and an empty Body, and never wraps",
    () =>
      Effect.gen(function* () {
        const { ids } = yield* Effect.promise(() =>
          buildCourse("v1", null, [
            {
              order: 1,
              lessons: [
                {
                  order: 1,
                  videos: [
                    // Titles are deliberately inserted out of order: a Lesson's
                    // Videos run by title.
                    { title: "b-current", body: "written", clips: 1 },
                    { title: "a-before", body: null, clips: 1 },
                    { title: "c-has-body", body: "done", clips: 1 },
                    { title: "d-no-clips", body: null },
                    { title: "e-archived-clips-only", archivedClips: 2 },
                    {
                      title: "f-archived",
                      body: null,
                      clips: 1,
                      archived: true,
                    },
                  ],
                },
                {
                  order: 2,
                  archived: true,
                  videos: [{ title: "g-archived-lesson", clips: 1 }],
                },
              ],
            },
            {
              order: 2,
              archived: true,
              lessons: [
                {
                  order: 1,
                  videos: [{ title: "h-archived-section", clips: 1 }],
                },
              ],
            },
            {
              order: 3,
              lessons: [
                {
                  order: 1,
                  videos: [
                    { title: "i-whitespace", body: "  \n\t ", clips: 3 },
                  ],
                },
                {
                  order: 2,
                  videos: [{ title: "j-empty-string", body: "", clips: 1 }],
                },
              ],
            },
          ])
        );

        // Skips: has a Body, no Clips, only archived Clips, archived Video,
        // archived Lesson, archived Section. Whitespace counts as empty.
        expect(yield* findNext(ids["b-current"]!)).toBe(ids["i-whitespace"]);
        expect(yield* findNext(ids["i-whitespace"]!)).toBe(
          ids["j-empty-string"]
        );
        // The last one: no wrap back to "a-before".
        expect(yield* findNext(ids["j-empty-string"]!)).toBeNull();
      })
  );

  it.effect("stays inside the current Video's Course Version", () =>
    Effect.gen(function* () {
      const older = yield* Effect.promise(() =>
        buildCourse("v1", null, [
          {
            order: 1,
            lessons: [
              {
                order: 1,
                videos: [
                  { title: "current", body: "x", clips: 1 },
                  { title: "older-next", clips: 1 },
                ],
              },
            ],
          },
        ])
      );
      // A later Version of the same Course, with its own empty-Body Video.
      yield* Effect.promise(() =>
        buildCourse("v2", older.repoId, [
          {
            order: 1,
            lessons: [{ order: 1, videos: [{ title: "newer", clips: 1 }] }],
          },
        ])
      );

      expect(yield* findNext(older.ids["current"]!)).toBe(
        older.ids["older-next"]
      );
    })
  );
});
