import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { Effect, Layer } from "effect";
import { getTableColumns } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { VersionOperationsService } from "./db-version-operations.server.js";
import { DrizzleService } from "./drizzle-service.server.js";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "../test-utils/pglite.js";
import * as schema from "../db/schema.js";
import {
  COPY_PATHS,
  parentEdges,
  pathToRoot,
  shortName,
  tablesBelow,
} from "./version-copy-manifest.js";

/**
 * Submit's round-trip invariant. A fixture GENERATED from the Drizzle schema
 * puts two rows with non-default values in every column of every table below
 * a Course Version; Submit clones it; then every table's rows in the new Draft
 * must equal the source's, column for column, with each id and foreign key
 * replaced by the content of the row it points at. That catches a dropped
 * column (#1834), a missing table (#1839) and a wrong remap — a link pointing
 * back into the source Version — alike.
 *
 * A new table or column is covered with no edit here. A column type the
 * generator cannot fill fails loudly, and so does a column Submit drops that
 * is not in NOT_CARRIED with its reason.
 */

const ROOT = COPY_PATHS.submit.root;
const ROWS_PER_TABLE = 2;

/** Columns a copy deliberately does not carry, as `table.key`, with why. */
const NOT_CARRIED: Record<string, string> = {
  "section.previousVersionSectionId": "points at its source row (checked)",
  "lesson.previousVersionLessonId": "points at its source row (checked)",
  "section.createdAt": "a copy is a new row",
  "learning_goal.createdAt": "a copy is a new row",
  "lesson.createdAt": "a copy is a new row",
  "video.createdAt": "a copy is a new row",
  "video.updatedAt": "a copy is a new row",
  "clip.createdAt": "a copy is a new row",
  "chapter.createdAt": "a copy is a new row",
  "beat.createdAt": "a copy is a new row",
  "clip_mockup.createdAt": "a copy is a new row",
  "clip_mockup_chapter.createdAt": "a copy is a new row",
  "thumbnail.createdAt": "a copy is a new row",
};

/**
 * Values the generator must not choose itself: CHECK constraints, and foreign
 * keys that leave the Version tree. Called per row; `i` is the row's index.
 */
const OVERRIDES: Record<
  string,
  (i: number, ctx: { snapshotId: string }) => unknown
> = {
  // CHECK video_format_valid; "short" is the non-default value.
  "video.format": () => "short",
  // A course Video never has a Pitch (moving one into a Lesson clears it).
  "video.pitchId": () => null,
  // Diagram Snapshots are shared per Diagram, not owned by a Version.
  "clip.diagramSnapshotId": (_i, ctx) => ctx.snapshotId,
  // CHECK clip_mockup_comment_one_parent: row 0 on a Clip Mockup, row 1 on
  // a Clip Mockup Chapter.
  "clip_mockup_comment.clipMockupId": (i) => (i % 2 === 0 ? undefined : null),
  "clip_mockup_comment.clipMockupChapterId": (i) =>
    i % 2 === 1 ? undefined : null,
};

type Row = Record<string, unknown>;

const generateValue = (
  table: PgTable,
  key: string,
  column: ReturnType<typeof getTableColumns>[string],
  i: number
): unknown => {
  const tag = `${shortName(table)}.${key}#${i}`;
  switch (column.columnType) {
    case "PgVarchar":
    case "PgText":
      return tag;
    case "PgCustomColumn":
      if (column.getSQLType().startsWith("varchar")) return tag;
      break;
    case "PgInteger":
      return 100 + i;
    case "PgDoublePrecision":
      return 1000.5 + i;
    case "PgBoolean":
      return column.default !== true;
    case "PgTimestamp":
      return new Date(Date.UTC(2001, 0, 1 + i));
    case "PgJsonb":
      return [{ tag }];
    case "PgArray":
      return [`${tag}a`, `${tag}b`];
  }
  throw new Error(
    `Cannot generate a value for ${tag} (${column.columnType} ${column.getSQLType()}) — teach generateValue() this column type`
  );
};

/** Parents before children, below the root. */
const topoOrder = (tables: PgTable[]) => {
  const ordered: PgTable[] = [];
  const visit = (t: PgTable) => {
    if (ordered.includes(t)) return;
    for (const edge of parentEdges(t)) {
      if (tables.includes(edge.to)) visit(edge.to);
    }
    ordered.push(t);
  };
  tables.forEach(visit);
  return ordered;
};

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

async function generateVersionTree() {
  const [course] = await testDb
    .insert(schema.courses)
    .values({ name: "Course" })
    .returning();
  const [version] = await testDb
    .insert(schema.courseVersions)
    .values({ repoId: course!.id, name: "v1" })
    .returning();
  const [diagram] = await testDb
    .insert(schema.diagrams)
    .values({ name: "Diagram" })
    .returning();
  const [snapshot] = await testDb
    .insert(schema.diagramSnapshots)
    .values({ diagramId: diagram!.id, scene: {}, contentHash: "h" })
    .returning();
  const ctx = { snapshotId: snapshot!.id };

  const below = tablesBelow(ROOT);
  const inserted = new Map<PgTable, Row[]>();
  for (const table of topoOrder(below)) {
    const edges = new Map(parentEdges(table).map((e) => [e.key, e]));
    const rows: Row[] = [];
    for (let i = 0; i < ROWS_PER_TABLE; i++) {
      const row: Row = {};
      for (const [key, column] of Object.entries(getTableColumns(table))) {
        const name = `${shortName(table)}.${key}`;
        const edge = edges.get(key);
        let value: unknown;
        if (key === "archived") value = false;
        else if (key === "archivedAt") value = null;
        else if (key === "id") value = crypto.randomUUID();
        else if (edge?.to === ROOT) value = version!.id;
        else if (edge && below.includes(edge.to)) {
          value = inserted.get(edge.to)![i % ROWS_PER_TABLE]!.id;
        } else if (edge && !(name in OVERRIDES)) {
          throw new Error(
            `${name} points outside the Version tree (${shortName(edge.to)}) — say what it holds in OVERRIDES`
          );
        } else value = generateValue(table, key, column, i);
        const override = OVERRIDES[name]?.(i, ctx);
        row[key] = override === undefined ? value : override;
      }
      rows.push(row);
    }
    await testDb.insert(table).values(rows as never);
    inserted.set(table, rows);
  }
  return { course: course!, version: version! };
}

/** Every row below each Version, keyed by table, with a signature per row. */
async function signaturesByVersion() {
  const below = tablesBelow(ROOT);
  const all = new Map<PgTable, Row[]>();
  for (const table of below) {
    all.set(table, (await testDb.select().from(table)) as Row[]);
  }
  const byId = new Map<PgTable, Map<unknown, Row>>(
    below.map((t) => [t, new Map(all.get(t)!.map((r) => [r.id, r]))])
  );

  const versionOf = (table: PgTable, row: Row): string => {
    let at: Row = row;
    for (const edge of pathToRoot(table, ROOT)!) {
      if (edge.to === ROOT) return at[edge.key] as string;
      at = byId.get(edge.to)!.get(at[edge.key])!;
    }
    throw new Error("unreachable");
  };

  const memo = new Map<Row, Row>();
  const signature = (table: PgTable, row: Row): Row => {
    const cached = memo.get(row);
    if (cached) return cached;
    const own = versionOf(table, row);
    const edges = new Map(parentEdges(table).map((e) => [e.key, e]));
    const out: Row = {};
    for (const [key, value] of Object.entries(row)) {
      const name = `${shortName(table)}.${key}`;
      const edge = edges.get(key);
      if (key === "id" || name in NOT_CARRIED) continue;
      if (edge?.to === ROOT) out[key] = "ROOT";
      else if (edge && byId.has(edge.to) && value !== null) {
        const parent = byId.get(edge.to)!.get(value)!;
        out[key] =
          versionOf(edge.to, parent) === own
            ? signature(edge.to, parent)
            : `POINTS INTO ANOTHER VERSION: ${shortName(edge.to)}`;
      } else out[key] = value instanceof Date ? value.toISOString() : value;
    }
    memo.set(row, out);
    return out;
  };

  return (versionId: string) =>
    new Map(
      below.map((table) => [
        shortName(table),
        all
          .get(table)!
          .filter((row) => versionOf(table, row) === versionId)
          .map((row) => signature(table, row))
          .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
      ])
    );
}

describe("Submit round trip — the new Draft is the old one, row for row", () => {
  it("names only real columns in NOT_CARRIED and OVERRIDES", () => {
    const real = new Set(
      tablesBelow(ROOT).flatMap((t) =>
        Object.keys(getTableColumns(t)).map((k) => `${shortName(t)}.${k}`)
      )
    );
    for (const name of [
      ...Object.keys(NOT_CARRIED),
      ...Object.keys(OVERRIDES),
    ]) {
      expect(real.has(name), `stale entry "${name}"`).toBe(true);
    }
  });

  it("carries every column of every copied table, with ids remapped", async () => {
    const { course, version } = await generateVersionTree();

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const versionOps = yield* VersionOperationsService;
        return yield* versionOps.freezeAndCloneVersion({
          sourceVersionId: version.id,
          repoId: course.id,
          sourceName: "v1",
          sourceDescription: "",
        });
      }).pipe(Effect.provide(testLayer))
    );

    const of = await signaturesByVersion();
    const source = of(version.id);
    const copy = of(result.version.id);
    for (const [name, decision] of Object.entries(COPY_PATHS.submit.tables)) {
      expect(source.get(name)!.length, `the fixture left "${name}" empty`).toBe(
        ROWS_PER_TABLE
      );
      if (decision === "copied") {
        expect(copy.get(name), `"${name}" did not round-trip`).toEqual(
          source.get(name)
        );
      } else {
        expect(copy.get(name), `"${name}" is notCopied`).toEqual([]);
      }
    }

    // previousVersion*Id is the one carried link that SHOULD point back.
    const sourceSections = new Set(
      (
        await testDb.query.sections.findMany({
          where: (s, { eq }) => eq(s.repoVersionId, version.id),
        })
      ).map((s) => s.id)
    );
    const newSections = await testDb.query.sections.findMany({
      where: (s, { eq }) => eq(s.repoVersionId, result.version.id),
      with: { lessons: true },
    });
    for (const section of newSections) {
      expect(sourceSections.has(section.previousVersionSectionId!)).toBe(true);
    }
    const sourceLessonIds = new Set(
      (
        await testDb.query.lessons.findMany({
          where: (l, { inArray }) => inArray(l.sectionId, [...sourceSections]),
        })
      ).map((l) => l.id)
    );
    for (const lesson of newSections.flatMap((s) => s.lessons)) {
      expect(sourceLessonIds.has(lesson.previousVersionLessonId!)).toBe(true);
    }
  });
});
