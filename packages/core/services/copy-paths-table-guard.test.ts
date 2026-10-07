import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { Effect, Layer } from "effect";
import { getTableName, is, sql } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { VersionOperationsService } from "./db-version-operations.server.js";
import { DrizzleService, type Database } from "./drizzle-service.server.js";
import { makeDuplicateCourse } from "./db-course-duplicate.server.js";
import { copyVideoImpl } from "./db-video-operations.copy.server.js";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "../test-utils/pglite.js";
import * as schema from "../db/schema.js";

/**
 * The TABLE-level copy guard. The column guards (db-version-copy.test.ts,
 * db-duplicate-course-drift.test.ts) only see tables a path already copies,
 * which is how six child tables went uncopied by every path unnoticed.
 *
 * This one derives, from the Drizzle schema's foreign keys, every table that
 * hangs below each copy path's root — a Course Version for Submit and
 * duplicateCourse, a Video for the Video copy — and demands a decision for
 * each: `copied`, or `notCopied` with the reason. A new child table fails here
 * until someone decides. The end-to-end test then holds each decision to the
 * truth: a `copied` table must have rows under the copy, a `notCopied` one none.
 */

type Decision = "copied" | { notCopied: string };
type PathName = "submit" | "duplicateCourse" | "videoCopy";

const NEVER_POSTED =
  "A Video Post records where one Video row was posted. Only standalone " +
  "Shorts are posted, and they never sit in a Course; a copied Video has " +
  "never been posted anywhere.";

const COPY_PATHS: Record<
  PathName,
  { root: PgTable; tables: Record<string, Decision> }
> = {
  submit: {
    root: schema.courseVersions,
    tables: {
      section: "copied",
      learning_goal: "copied",
      lesson: "copied",
      video: "copied",
      clip: "copied",
      clip_web_link: "copied",
      clip_transcript_word: "copied",
      overlay: "copied",
      chapter: "copied",
      beat: "copied",
      beat_learning_goal: "copied",
      clip_mockup: "copied",
      clip_mockup_chapter: "copied",
      clip_mockup_comment: "copied",
      thumbnail: "copied",
      video_post: { notCopied: NEVER_POSTED },
    },
  },
  duplicateCourse: {
    root: schema.courseVersions,
    tables: {
      section: "copied",
      learning_goal: "copied",
      lesson: "copied",
      video: "copied",
      clip: "copied",
      clip_web_link: "copied",
      clip_transcript_word: "copied",
      overlay: "copied",
      chapter: "copied",
      beat: "copied",
      beat_learning_goal: "copied",
      clip_mockup: "copied",
      clip_mockup_chapter: "copied",
      clip_mockup_comment: "copied",
      thumbnail: "copied",
      video_post: { notCopied: NEVER_POSTED },
    },
  },
  videoCopy: {
    root: schema.videos,
    tables: {
      clip: "copied",
      clip_web_link: "copied",
      clip_transcript_word: "copied",
      overlay: "copied",
      chapter: "copied",
      beat: "copied",
      beat_learning_goal: "copied",
      clip_mockup: "copied",
      clip_mockup_chapter: "copied",
      clip_mockup_comment: "copied",
      thumbnail: {
        notCopied:
          "Thumbnail PNG paths are keyed by the source Video's lineage " +
          "(#1674) and this path neither rebases nor moves them, so verbatim " +
          "rows would alias the source's files. A copy starts without one.",
      },
      video_post: { notCopied: NEVER_POSTED },
    },
  },
};

// ---------------------------------------------------------------------------
// The FK graph, read from the schema.

const PREFIX = "course-video-manager_";
const ALL_TABLES: PgTable[] = (Object.values(schema) as unknown[]).filter(
  (value): value is PgTable => is(value, PgTable)
);
const shortName = (table: PgTable) => getTableName(table).replace(PREFIX, "");

type Edge = { from: PgTable; column: string; to: PgTable; toColumn: string };

const parentEdges = (table: PgTable): Edge[] =>
  getTableConfig(table).foreignKeys.flatMap((fk) => {
    const ref = fk.reference();
    const to = ref.foreignTable;
    return to === table
      ? []
      : [
          {
            from: table,
            column: ref.columns[0]!.name,
            to,
            toColumn: ref.foreignColumns[0]!.name,
          },
        ];
  });

/** Shortest chain of foreign keys from `table` up to `root`, if any. */
const pathToRoot = (table: PgTable, root: PgTable): Edge[] | undefined => {
  const queue: Array<{ at: PgTable; path: Edge[] }> = [{ at: table, path: [] }];
  const seen = new Set<PgTable>([table]);
  while (queue.length > 0) {
    const { at, path } = queue.shift()!;
    for (const edge of parentEdges(at)) {
      if (edge.to === root) return [...path, edge];
      if (seen.has(edge.to)) continue;
      seen.add(edge.to);
      queue.push({ at: edge.to, path: [...path, edge] });
    }
  }
  return undefined;
};

const tablesBelow = (root: PgTable) =>
  ALL_TABLES.filter((t) => t !== root && pathToRoot(t, root));

const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;

/** How many `table` rows hang below the root row `rootId`. */
const countBelow = async (
  db: TestDb,
  table: PgTable,
  root: PgTable,
  rootId: string
) => {
  const path = pathToRoot(table, root)!;
  const joins = path
    .slice(0, -1)
    .map(
      (edge, i) =>
        `JOIN ${quote(getTableName(edge.to))} t${i + 1} ON t${i}.${quote(edge.column)} = t${i + 1}.${quote(edge.toColumn)}`
    )
    .join(" ");
  const last = path[path.length - 1]!;
  const { rows } = await db.execute<{ n: number }>(
    sql`${sql.raw(
      `SELECT count(*)::int AS n FROM ${quote(getTableName(table))} t0 ${joins} WHERE t${path.length - 1}.${quote(last.column)} = `
    )}${rootId}`
  );
  return rows[0]!.n;
};

// ---------------------------------------------------------------------------

let testDb: TestDb;
let versionLayer: Layer.Layer<VersionOperationsService>;

beforeAll(async () => {
  testDb = (await createTestDb()).testDb;
  versionLayer = VersionOperationsService.Default.pipe(
    Layer.provide(Layer.succeed(DrizzleService, testDb as any))
  );
});

beforeEach(async () => {
  await truncateAllTables(testDb);
});

const db = () => testDb as unknown as Database;

/** One live row in every table below a Course Version. */
async function seedEveryTable() {
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
  const videoId = video!.id;
  const [clip] = await testDb
    .insert(schema.clips)
    .values({
      videoId,
      videoFilename: "take.mp4",
      sourceStartTime: 0,
      sourceEndTime: 5,
      order: "a0",
      text: "hi",
    })
    .returning();
  const clipId = clip!.id;
  await testDb
    .insert(schema.clipWebLinks)
    .values({ clipId, url: "https://example.com" });
  await testDb
    .insert(schema.clipTranscriptWords)
    .values({ clipId, start: 0, end: 0.5, text: "hi" });
  await testDb.insert(schema.overlays).values({
    clipId,
    at: 1,
    durationInSeconds: 2,
    title: "Term",
    description: "Definition",
  });
  await testDb
    .insert(schema.chapters)
    .values({ videoId, name: "Chapter", order: "a0" });
  const [beat] = await testDb
    .insert(schema.beats)
    .values({ videoId, kind: "definition", title: "Beat", order: "a0" })
    .returning();
  await testDb
    .insert(schema.beatLearningGoals)
    .values({ beatId: beat!.id, learningGoalId: goal!.id });
  const [mockup] = await testDb
    .insert(schema.clipMockups)
    .values({
      videoId,
      line: "Line",
      imagePath: "a.png",
      audioPath: "a.wav",
      durationSeconds: 1,
      order: "a0",
    })
    .returning();
  await testDb
    .insert(schema.clipMockupChapters)
    .values({ videoId, name: "Part", order: "a1" });
  await testDb
    .insert(schema.clipMockupComments)
    .values({ videoId, clipMockupId: mockup!.id, body: "Note" });
  await testDb
    .insert(schema.thumbnails)
    .values({ videoId, layers: [], filePath: null });
  await testDb.insert(schema.videoPosts).values({ videoId, platform: "x" });
  return { course: course!, version: version!, video: video! };
}

/** Runs one copy path; returns the root row the copy hangs below. */
const RUN_PATH: Record<
  PathName,
  (seed: Awaited<ReturnType<typeof seedEveryTable>>) => Promise<string>
> = {
  submit: async ({ course, version }) => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const versionOps = yield* VersionOperationsService;
        return yield* versionOps.freezeAndCloneVersion({
          sourceVersionId: version.id,
          repoId: course.id,
          sourceName: "v1",
          sourceDescription: "",
        });
      }).pipe(Effect.provide(versionLayer))
    );
    return result.version.id;
  },
  duplicateCourse: async ({ course }) => {
    const result = await Effect.runPromise(
      makeDuplicateCourse(db())({ sourceCourseId: course.id, name: "Copy" })
    );
    return result.version.id;
  },
  videoCopy: async ({ video }) =>
    Effect.runPromise(
      copyVideoImpl(db(), {
        sourceVideoId: video.id,
        newTitle: "Copy",
        copyClips: true,
        copyBeats: true,
        copyScript: true,
        renameOld: true,
      })
    ),
};

const sourceRootId = (
  path: PathName,
  seed: Awaited<ReturnType<typeof seedEveryTable>>
) => (path === "videoCopy" ? seed.video.id : seed.version.id);

describe("copy paths — table-level guard", () => {
  for (const [path, spec] of Object.entries(COPY_PATHS) as Array<
    [PathName, (typeof COPY_PATHS)[PathName]]
  >) {
    it(`${path}: decides every table below ${shortName(spec.root)} (add a child table => this fails)`, () => {
      const below = tablesBelow(spec.root).map(shortName).sort();
      expect(
        below,
        `a table hangs below "${shortName(spec.root)}" with no decision for ${path}: classify it in COPY_PATHS.${path} as "copied", or { notCopied: "<why>" }`
      ).toEqual(Object.keys(spec.tables).sort());
    });

    it(`${path}: copies exactly the tables it says it does`, async () => {
      const seed = await seedEveryTable();
      const below = tablesBelow(spec.root);
      // A table with no source row could never fail the check below.
      for (const table of below) {
        expect(
          await countBelow(testDb, table, spec.root, sourceRootId(path, seed)),
          `seedEveryTable() leaves "${shortName(table)}" empty — give it a row`
        ).toBeGreaterThan(0);
      }

      const copyRootId = await RUN_PATH[path](seed);

      for (const table of below) {
        const name = shortName(table);
        const copied = await countBelow(testDb, table, spec.root, copyRootId);
        if (spec.tables[name] === "copied") {
          expect(copied, `${path} did not copy "${name}"`).toBeGreaterThan(0);
        } else {
          expect(copied, `${path} copied "${name}", declared notCopied`).toBe(
            0
          );
        }
      }
    });
  }
});
