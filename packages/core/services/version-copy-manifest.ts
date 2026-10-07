import { getTableColumns, getTableName, is, sql } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import * as schema from "../db/schema.js";
import type { Database } from "./drizzle-service.server.js";

/**
 * Which copy path carries which table, and the FK graph that says which tables
 * there are. Product code, not test code, because Submit itself reads it: after
 * the copy, every `copied` table's live row count in the new Draft must equal
 * the source's (see `assertCopyComplete` in db-version-copy.server.ts), or the
 * Submit rolls back.
 *
 * copy-paths-table-guard.test.ts fails until every table below a path's root
 * is decided here, and holds each decision to what the path really does.
 */

export type CopyDecision = "copied" | { notCopied: string };
export type CopyPathName = "submit" | "duplicateCourse" | "videoCopy";

const NEVER_POSTED =
  "A Video Post records where one Video row was posted. Only standalone " +
  "Shorts are posted, and they never sit in a Course; a copied Video has " +
  "never been posted anywhere.";

/** Every table below a Course Version, decided for a whole-version copy. */
const VERSION_TABLES: Record<string, CopyDecision> = {
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
};

export const COPY_PATHS: Record<
  CopyPathName,
  { root: PgTable; tables: Record<string, CopyDecision> }
> = {
  submit: { root: schema.courseVersions, tables: VERSION_TABLES },
  duplicateCourse: { root: schema.courseVersions, tables: VERSION_TABLES },
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
// The FK graph, read from the Drizzle schema.

const PREFIX = "course-video-manager_";

export const ALL_TABLES: PgTable[] = (
  Object.values(schema) as unknown[]
).filter((value): value is PgTable => is(value, PgTable));

export const shortName = (table: PgTable) =>
  getTableName(table).replace(PREFIX, "");

export const tableByShortName = (name: string) =>
  ALL_TABLES.find((t) => shortName(t) === name)!;

export type FkEdge = {
  from: PgTable;
  column: string;
  /** The TS key of `column` on `from`. */
  key: string;
  notNull: boolean;
  to: PgTable;
  toColumn: string;
};

export const parentEdges = (table: PgTable): FkEdge[] => {
  const keyOf = new Map(
    Object.entries(getTableColumns(table)).map(([key, col]) => [col.name, key])
  );
  return getTableConfig(table).foreignKeys.flatMap((fk) => {
    const ref = fk.reference();
    const column = ref.columns[0]!;
    return ref.foreignTable === table
      ? []
      : [
          {
            from: table,
            column: column.name,
            key: keyOf.get(column.name)!,
            notNull: column.notNull,
            to: ref.foreignTable,
            toColumn: ref.foreignColumns[0]!.name,
          },
        ];
  });
};

/** Shortest chain of foreign keys from `table` up to `root`, if any. */
export const pathToRoot = (
  table: PgTable,
  root: PgTable
): FkEdge[] | undefined => {
  const queue: Array<{ at: PgTable; path: FkEdge[] }> = [
    { at: table, path: [] },
  ];
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

export const tablesBelow = (root: PgTable) =>
  ALL_TABLES.filter((t) => t !== root && pathToRoot(t, root));

const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;

/** SQL that a row of `table` (as `alias`) is not archived itself. */
const notArchived = (table: PgTable, alias: string) => {
  const columns = getTableColumns(table);
  if ("archived" in columns) return [`${alias}."archived" = false`];
  if ("archivedAt" in columns) return [`${alias}."archived_at" IS NULL`];
  return [];
};

/**
 * SQL that a row is LIVE: not archived, and every parent it points at below
 * `root` live too — so a Clip Mockup Comment on an archived Clip Mockup, or a
 * Beat link to an archived Beat, does not count. That is exactly what every
 * copy path carries.
 */
const liveSql = (
  table: PgTable,
  alias: string,
  root: PgTable,
  below: ReadonlySet<PgTable>
): string => {
  const conditions = notArchived(table, alias);
  parentEdges(table).forEach((edge, i) => {
    if (!below.has(edge.to)) return;
    const parent = `${alias}_${i}`;
    const exists = `EXISTS (SELECT 1 FROM ${quote(getTableName(edge.to))} ${parent} WHERE ${parent}.${quote(edge.toColumn)} = ${alias}.${quote(edge.column)} AND ${liveSql(edge.to, parent, root, below)})`;
    conditions.push(
      edge.notNull
        ? exists
        : `(${alias}.${quote(edge.column)} IS NULL OR ${exists})`
    );
  });
  return conditions.length > 0 ? conditions.join(" AND ") : "TRUE";
};

/** How many LIVE `table` rows hang below the root row `rootId`. */
export const countLiveBelow = async (
  db: Pick<Database, "execute">,
  table: PgTable,
  root: PgTable,
  rootId: string
): Promise<number> => {
  const path = pathToRoot(table, root)!;
  const joins = path
    .slice(0, -1)
    .map(
      (edge, i) =>
        `JOIN ${quote(getTableName(edge.to))} t${i + 1} ON t${i}.${quote(edge.column)} = t${i + 1}.${quote(edge.toColumn)}`
    )
    .join(" ");
  const last = path[path.length - 1]!;
  const live = liveSql(table, "t0", root, new Set(tablesBelow(root)));
  const result = await db.execute<{ n: number }>(
    sql`${sql.raw(
      `SELECT count(*)::int AS n FROM ${quote(getTableName(table))} t0 ${joins} WHERE ${live} AND t${path.length - 1}.${quote(last.column)} = `
    )}${rootId}`
  );
  return Number(result.rows[0]!.n);
};
