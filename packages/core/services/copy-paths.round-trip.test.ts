import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { Effect, Layer } from "effect";
import { DrizzleService, type Database } from "./drizzle-service.server.js";
import { VideoOperationsService } from "./db-video-operations.server.js";
import { copyVideoImpl } from "./db-video-operations.copy.server.js";
import { createVideoFromSelectionImpl } from "./db-video-from-selection.server.js";
import { concatenateVideos } from "./db-video-concatenation.server.js";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "../test-utils/pglite.js";
import * as schema from "../db/schema.js";
import { COPY_PATHS, type CopyPathName } from "./version-copy-manifest.js";
import {
  columnNamesBelow,
  generateTreeBelow,
  type Overrides,
  ROWS_PER_TABLE,
  signaturesBelow,
} from "../test-utils/copy-round-trip.js";

/**
 * The Video-level copy paths' round trip — Submit's is
 * db-version-copy.round-trip.test.ts. A fixture GENERATED from the Drizzle
 * schema fills every column of every table below a Video; each path copies
 * it; then every table the path declares `copied` in COPY_PATHS must come out
 * equal to the source, column for column, with ids and links remapped, and
 * every `notCopied` table empty. A Clip child table or column added later is
 * covered with no edit here — and fails until every path carries it.
 */

const VIDEO_PATHS = (Object.keys(COPY_PATHS) as CopyPathName[]).filter(
  (path) => COPY_PATHS[path].root === schema.videos
);

const ROOT = schema.videos;

/** Columns a Video-level copy deliberately does not carry, with why. */
const NOT_CARRIED: Record<string, string> = {
  "clip.createdAt": "a copy is a new row",
  "chapter.createdAt": "a copy is a new row",
  "beat.createdAt": "a copy is a new row",
  "clip_mockup.createdAt": "a copy is a new row",
  "clip_mockup_chapter.createdAt": "a copy is a new row",
  "thumbnail.createdAt": "a copy is a new row",
  "clip.order":
    "re-keyed in the copy's own order space (order is tested apart)",
  "chapter.order": "re-keyed, as clip.order",
  "beat.order": "re-keyed, as clip.order",
  "clip_mockup.order": "re-keyed, as clip.order",
  "clip_mockup_chapter.order": "re-keyed, as clip.order",
};

/** CHECK constraints, and foreign keys that leave the Video tree. */
const overrides = (ctx: {
  snapshotId: string;
  learningGoalId: string;
}): Overrides => ({
  // Diagram Snapshots are shared per Diagram, not owned by a Video.
  "clip.diagramSnapshotId": () => ctx.snapshotId,
  // A Learning Goal belongs to the Video's Section, which every copy shares.
  "beat_learning_goal.learningGoalId": () => ctx.learningGoalId,
  // CHECK clip_mockup_comment_one_parent: row 0 on a Clip Mockup, row 1 on
  // a Clip Mockup Chapter.
  "clip_mockup_comment.clipMockupId": (i) => (i % 2 === 0 ? undefined : null),
  "clip_mockup_comment.clipMockupChapterId": (i) =>
    i % 2 === 1 ? undefined : null,
});

let testDb: TestDb;
let videoLayer: Layer.Layer<VideoOperationsService | DrizzleService>;

beforeAll(async () => {
  testDb = (await createTestDb()).testDb;
  const drizzleLayer = Layer.succeed(DrizzleService, testDb as any);
  videoLayer = Layer.mergeAll(
    VideoOperationsService.Default.pipe(Layer.provide(drizzleLayer)),
    drizzleLayer
  );
});

beforeEach(async () => {
  await truncateAllTables(testDb);
});

const db = () => testDb as unknown as Database;

async function generateVideoTree() {
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
    .values({ repoVersionId: version!.id, title: "Section", order: 1 })
    .returning();
  const [goal] = await testDb
    .insert(schema.learningGoals)
    .values({ sectionId: section!.id, title: "Goal", order: 1 })
    .returning();
  const [lesson] = await testDb
    .insert(schema.lessons)
    .values({ sectionId: section!.id, title: "Lesson", order: 1 })
    .returning();
  const [video] = await testDb
    .insert(schema.videos)
    .values({ lessonId: lesson!.id, title: "v.mp4", originalFootagePath: "/f" })
    .returning();
  const [diagram] = await testDb
    .insert(schema.diagrams)
    .values({ name: "Diagram" })
    .returning();
  const [snapshot] = await testDb
    .insert(schema.diagramSnapshots)
    .values({ diagramId: diagram!.id, scene: {}, contentHash: "h" })
    .returning();
  await generateTreeBelow(
    testDb,
    ROOT,
    video!.id,
    overrides({ snapshotId: snapshot!.id, learningGoalId: goal!.id })
  );
  return video!;
}

/** Runs one Video-level path on the whole source; returns the copy's id. */
const RUN_PATH: Partial<
  Record<CopyPathName, (sourceVideoId: string) => Promise<string>>
> = {
  videoCopy: (sourceVideoId) =>
    Effect.runPromise(
      copyVideoImpl(db(), {
        sourceVideoId,
        newTitle: "Copy",
        copyClips: true,
        copyBeats: true,
        copyScript: true,
        renameOld: true,
      })
    ),
  createVideoFromSelection: async (sourceVideoId) => {
    const [clips, chapters] = await Promise.all([
      testDb.query.clips.findMany({
        where: (c, { eq }) => eq(c.videoId, sourceVideoId),
      }),
      testDb.query.chapters.findMany({
        where: (c, { eq }) => eq(c.videoId, sourceVideoId),
      }),
    ]);
    const copy = await Effect.runPromise(
      createVideoFromSelectionImpl(db(), {
        sourceVideoId,
        clipIds: clips.map((c) => c.id),
        chapterIds: chapters.map((c) => c.id),
        title: "Selection",
        mode: "copy",
      })
    );
    return copy.id;
  },
  concatenateVideos: async (sourceVideoId) => {
    const copy = await Effect.runPromise(
      concatenateVideos({
        name: "Joined",
        sourceVideoIds: [sourceVideoId],
        format: "landscape",
      }).pipe(Effect.provide(videoLayer))
    );
    return copy.id;
  },
};

describe("Video-level copy paths round trip — the copy is the source, row for row", () => {
  it("names only real columns in NOT_CARRIED and the overrides", () => {
    const real = columnNamesBelow(ROOT);
    for (const name of [
      ...Object.keys(NOT_CARRIED),
      ...Object.keys(overrides({ snapshotId: "", learningGoalId: "" })),
    ]) {
      expect(real.has(name), `stale entry "${name}"`).toBe(true);
    }
  });

  for (const path of VIDEO_PATHS) {
    it(`${path}: carries every column of every copied table, with ids remapped`, async () => {
      const run = RUN_PATH[path];
      expect(run, `teach RUN_PATH how to run ${path}`).toBeDefined();
      const source = await generateVideoTree();
      const copyId = await run!(source.id);

      const of = await signaturesBelow(testDb, ROOT, NOT_CARRIED);
      const before = of(source.id);
      const after = of(copyId);
      for (const [name, decision] of Object.entries(COPY_PATHS[path].tables)) {
        expect(
          before.get(name)!.length,
          `the fixture left "${name}" empty`
        ).toBe(ROWS_PER_TABLE);
        if (decision === "copied") {
          expect(
            after.get(name),
            `${path}: "${name}" did not round-trip`
          ).toEqual(before.get(name));
        } else {
          expect(after.get(name), `${path}: "${name}" is notCopied`).toEqual(
            []
          );
        }
      }
    });
  }
});
