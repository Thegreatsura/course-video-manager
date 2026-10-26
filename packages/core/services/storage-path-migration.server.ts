import { and, count, not, or, sql, type SQL } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import {
  avCalibrations,
  clips,
  recordingSessions,
  thumbnails,
  videos,
} from "../db/schema.js";
import type { Database } from "./drizzle-service.server.js";

/**
 * The one-off data migration to root-relative paths (#2104).
 *
 * Every path column that names a file on a Storage Root is rewritten from its
 * legacy absolute form (`/mnt/d/raw-footage/x.mp4`) to the form relative to
 * that root (`raw-footage/x.mp4`): strip `<root>/`, nothing else, so the result
 * is byte-for-byte what `toRootRelative` (apps/local storage package) computes
 * for the Export Hash. There is no schema change.
 *
 * Idempotent: a relative path is never touched again, so a second run rewrites
 * nothing. A path under no root (a Recording Session in `~/Videos`) is
 * reported as unmappable and left exactly as it is.
 *
 * It writes with plain UPDATEs, around the Draft guard ON PURPOSE: Version
 * freeze is enforced in app code only (`draft-guard.server.ts`), and a frozen
 * (Published) Version's Clips name the same Footage files as its Draft's, so
 * they must be rewritten too. The rewrite changes no Export Hash, so no frozen
 * Version's content changes.
 *
 * `thumbnail.file_path` is reported, never rewritten: thumbnails live in the
 * Video Files store, which is not under a Storage Root yet; #2105 moves them
 * and rewrites their rows.
 */

/** A column the migration rewrites. */
type MigratedColumn = {
  readonly name: string;
  readonly table: PgTable;
  readonly column: PgColumn;
};

export const MIGRATED_PATH_COLUMNS: readonly MigratedColumn[] = [
  { name: "clip.video_filename", table: clips, column: clips.videoFilename },
  {
    name: "recording_session.camera_file_path",
    table: recordingSessions,
    column: recordingSessions.cameraFilePath,
  },
  {
    name: "recording_session.screen_file_path",
    table: recordingSessions,
    column: recordingSessions.screenFilePath,
  },
  {
    name: "recording_session.mic_file_path",
    table: recordingSessions,
    column: recordingSessions.micFilePath,
  },
  {
    name: "video.original_footage_path",
    table: videos,
    column: videos.originalFootagePath,
  },
  {
    name: "av_calibration.mic_file_path",
    table: avCalibrations,
    column: avCalibrations.micFilePath,
  },
  {
    name: "av_calibration.browser_trace_path",
    table: avCalibrations,
    column: avCalibrations.scriptFilePath,
  },
];

/** Reported only: see the module comment. */
const REPORTED_ONLY_COLUMNS: readonly MigratedColumn[] = [
  {
    name: "thumbnail.file_path",
    table: thumbnails,
    column: thumbnails.filePath,
  },
];

export type ColumnMigrationReport = {
  readonly column: string;
  /** Rows under each root: rewritten on apply, would be on a dry run. */
  readonly underRoot: readonly { root: string; rows: number }[];
  /** Absolute paths under no root: left alone. */
  readonly unmappable: number;
  /** Up to ten of them, distinct, for the operator to read. */
  readonly unmappableSamples: readonly string[];
  /** Under a root but not in normal form (`//`, `.`, `..`): left as stored. */
  readonly notNormalized: number;
  /** Rows already relative (a previous run, or written after the switch). */
  readonly alreadyRelative: number;
};

export type StoragePathMigrationReport = {
  readonly applied: boolean;
  readonly columns: readonly ColumnMigrationReport[];
  /** Columns reported but never rewritten (thumbnails, #2105). */
  readonly reportedOnly: readonly ColumnMigrationReport[];
};

const underRootPredicate = (column: PgColumn, root: string): SQL =>
  sql`starts_with(${column}, ${`${root}/`})`;

/**
 * Already in normal form (no `//`, `.` or `..` segment, no trailing slash), so
 * stripping the root gives exactly what `toRootRelative` (which normalizes)
 * gives for the absolute path. Only such a path is rewritten; any other is
 * left as stored and reported, and keeps reading and hashing as it does now.
 */
const isNormalized = (column: PgColumn): SQL =>
  sql`(position('//' in ${column}) = 0 AND position('/./' in ${column}) = 0 AND position('/../' in ${column}) = 0 AND right(${column}, 1) <> '/' AND right(${column}, 2) <> '/.' AND right(${column}, 3) <> '/..')`;

const rewritable = (column: PgColumn, root: string): SQL =>
  sql`(${underRootPredicate(column, root)} AND ${isNormalized(column)})`;

const isAbsolute = (column: PgColumn): SQL => sql`starts_with(${column}, '/')`;

const countWhere = async (db: Database, table: PgTable, where: SQL) => {
  const [row] = await db.select({ n: count() }).from(table).where(where);
  return row?.n ?? 0;
};

const reportColumn = async (
  db: Database,
  roots: readonly string[],
  { name, table, column }: MigratedColumn
): Promise<ColumnMigrationReport> => {
  const underRoot: { root: string; rows: number }[] = [];
  for (const root of roots) {
    underRoot.push({
      root,
      rows: await countWhere(db, table, rewritable(column, root)),
    });
  }

  const notUnderAnyRoot = and(
    isAbsolute(column),
    ...roots.map((root) => not(underRootPredicate(column, root)))
  )!;
  const unmappable = await countWhere(db, table, notUnderAnyRoot);
  const samples = await db
    .selectDistinct({ path: sql<string>`${column}` })
    .from(table)
    .where(notUnderAnyRoot)
    .orderBy(sql`${column}`)
    .limit(10);
  const notNormalized = await countWhere(
    db,
    table,
    sql`(${or(...roots.map((root) => underRootPredicate(column, root)))}) AND NOT ${isNormalized(column)}`
  );
  const alreadyRelative = await countWhere(
    db,
    table,
    sql`${column} IS NOT NULL AND ${column} <> '' AND NOT ${isAbsolute(column)}`
  );

  return {
    column: name,
    underRoot,
    unmappable,
    unmappableSamples: samples.map((s) => s.path),
    notNormalized,
    alreadyRelative,
  };
};

/**
 * Report (and, with `apply`, perform) the rewrite. `roots` is the parsed
 * `STORAGE_ROOTS`: absolute, no trailing slash, none inside another.
 *
 * Applied in one transaction: either every mappable path is rewritten or
 * none is. The report is taken BEFORE the rewrite, so it says what was (or
 * would be) changed.
 */
export const migrateStoragePaths = async (
  db: Database,
  opts: { readonly roots: readonly string[]; readonly apply: boolean }
): Promise<StoragePathMigrationReport> => {
  const { roots, apply } = opts;
  for (const root of roots) {
    if (!root.startsWith("/") || root.endsWith("/")) {
      throw new Error(
        `Storage Root "${root}" must be absolute with no trailing slash`
      );
    }
  }

  const columns: ColumnMigrationReport[] = [];
  for (const c of MIGRATED_PATH_COLUMNS) {
    columns.push(await reportColumn(db, roots, c));
  }
  const reportedOnly: ColumnMigrationReport[] = [];
  for (const c of REPORTED_ONLY_COLUMNS) {
    reportedOnly.push(await reportColumn(db, roots, c));
  }

  if (apply) {
    await db.transaction(async (tx) => {
      for (const { table, column } of MIGRATED_PATH_COLUMNS) {
        for (const root of roots) {
          // `substr` is 1-based: skip `<root>/`.
          await tx.execute(
            sql`UPDATE ${table} SET ${sql.identifier(column.name)} = substr(${column}, ${root.length + 2}) WHERE ${rewritable(column, root)}`
          );
        }
      }
    });
  }

  return { applied: apply, columns, reportedOnly };
};
