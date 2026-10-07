import { getTableColumns } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import {
  parentEdges,
  pathToRoot,
  shortName,
  tablesBelow,
} from "../services/version-copy-manifest.js";
import type { TestDb } from "./pglite.js";

/**
 * The machinery behind the schema-generated round-trip tests of the copy
 * paths in COPY_PATHS (db-version-copy.round-trip.test.ts for Submit,
 * copy-paths.round-trip.test.ts for the Video-level paths).
 *
 * `generateTreeBelow` puts rows with non-default values in every column of
 * every table below a root row, straight from the Drizzle schema, so a new
 * table or column is covered with no edit. `signaturesBelow` then reads every
 * row back with each id and foreign key replaced by the content of the row it
 * points at, so a source and its copy compare equal exactly when the copy
 * carried every column, every row, and remapped every link.
 */

export type Row = Record<string, unknown>;

export const ROWS_PER_TABLE = 2;

/** Values the generator must not choose itself, as `table.key`; `i` is the row's index. */
export type Overrides = Record<string, (i: number) => unknown>;

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

/** `ROWS_PER_TABLE` generated rows in every table below the root row `rootId`. */
export async function generateTreeBelow(
  testDb: TestDb,
  root: PgTable,
  rootId: string,
  overrides: Overrides
) {
  const below = tablesBelow(root);
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
        else if (edge?.to === root) value = rootId;
        else if (edge && below.includes(edge.to)) {
          value = inserted.get(edge.to)![i % ROWS_PER_TABLE]!.id;
        } else if (edge && !(name in overrides)) {
          throw new Error(
            `${name} points outside the ${shortName(root)} tree (${shortName(edge.to)}) — say what it holds in the overrides`
          );
        } else value = generateValue(table, key, column, i);
        const override = overrides[name]?.(i);
        row[key] = override === undefined ? value : override;
      }
      rows.push(row);
    }
    await testDb.insert(table).values(rows as never);
    inserted.set(table, rows);
  }
}

/**
 * Reads every row below every root row; returns, for one root row, each
 * table's rows as sorted signatures. Columns in `notCarried` (`table.key`)
 * are left out.
 */
export async function signaturesBelow(
  testDb: TestDb,
  root: PgTable,
  notCarried: Readonly<Record<string, string>>
) {
  const below = tablesBelow(root);
  const all = new Map<PgTable, Row[]>();
  for (const table of below) {
    all.set(table, (await testDb.select().from(table)) as Row[]);
  }
  const byId = new Map<PgTable, Map<unknown, Row>>(
    below.map((t) => [t, new Map(all.get(t)!.map((r) => [r.id, r]))])
  );

  const rootOf = (table: PgTable, row: Row): string => {
    let at: Row = row;
    for (const edge of pathToRoot(table, root)!) {
      if (edge.to === root) return at[edge.key] as string;
      at = byId.get(edge.to)!.get(at[edge.key])!;
    }
    throw new Error("unreachable");
  };

  const memo = new Map<Row, Row>();
  const signature = (table: PgTable, row: Row): Row => {
    const cached = memo.get(row);
    if (cached) return cached;
    const own = rootOf(table, row);
    const edges = new Map(parentEdges(table).map((e) => [e.key, e]));
    const out: Row = {};
    for (const [key, value] of Object.entries(row)) {
      const name = `${shortName(table)}.${key}`;
      const edge = edges.get(key);
      if (key === "id" || name in notCarried) continue;
      if (edge?.to === root) out[key] = "ROOT";
      else if (edge && byId.has(edge.to) && value !== null) {
        const parent = byId.get(edge.to)!.get(value)!;
        out[key] =
          rootOf(edge.to, parent) === own
            ? signature(edge.to, parent)
            : `POINTS INTO ANOTHER ${shortName(root).toUpperCase()}: ${shortName(edge.to)}`;
      } else out[key] = value instanceof Date ? value.toISOString() : value;
    }
    memo.set(row, out);
    return out;
  };

  return (rootId: string) =>
    new Map(
      below.map((table) => [
        shortName(table),
        all
          .get(table)!
          .filter((row) => rootOf(table, row) === rootId)
          .map((row) => signature(table, row))
          .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
      ])
    );
}

/** Every `table.key` below `root`, to catch stale NOT_CARRIED / override entries. */
export const columnNamesBelow = (root: PgTable) =>
  new Set(
    tablesBelow(root).flatMap((t) =>
      Object.keys(getTableColumns(t)).map((k) => `${shortName(t)}.${k}`)
    )
  );
