import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { sql } from "drizzle-orm";
import * as schema from "../db/schema.js";
import { readFileSync } from "node:fs";
import "./pglite-snapshot.js";

export type TestDb = ReturnType<typeof drizzle<typeof schema>>;

async function getSnapshotPath(): Promise<string | undefined> {
  try {
    const { inject } = await import("vitest");
    return inject("pgliteSnapshotPath");
  } catch {
    return undefined;
  }
}

/**
 * Creates a single PGlite instance and migrates the schema once.
 *
 * Designed for use in `beforeAll` — spinning up one PGlite per file
 * instead of per test is significantly faster (~4-5x) because PGlite
 * boot + schema push is the expensive part, not the queries themselves.
 *
 * Use {@link truncateAllTables} in `beforeEach` to reset state between tests.
 */
export const createTestDb = async () => {
  const snapshotPath = await getSnapshotPath();

  if (snapshotPath) {
    const blob = new Blob([readFileSync(snapshotPath)]);
    const pglite = new PGlite({ loadDataDir: blob });
    const testDb = drizzle(pglite, { schema });
    return { pglite, testDb };
  }

  const { pushSchema } = await import("drizzle-kit/api");
  const pglite = new PGlite();
  const testDb = drizzle(pglite, { schema });
  const { apply } = await pushSchema(schema, testDb as any);
  await apply();
  return { pglite, testDb };
};

/** Every public table, quoted — read once per database, the schema never changes mid-file. */
const tableListCache = new WeakMap<TestDb, string>();

const quotedTableList = async (testDb: TestDb): Promise<string> => {
  const cached = tableListCache.get(testDb);
  if (cached !== undefined) return cached;
  const { rows } = await testDb.execute<{ tablename: string }>(
    sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`
  );
  const list = rows
    .map((r) => `"${r.tablename.replaceAll('"', '""')}"`)
    .join(", ");
  tableListCache.set(testDb, list);
  return list;
};

/**
 * Truncates every table in the public schema with CASCADE.
 *
 * Call this in `beforeEach` to give each test a clean database
 * without the overhead of recreating the PGlite instance.
 *
 * One TRUNCATE naming every table, not one per table: under PGlite the
 * per-table loop cost ~90ms per call — most of a typical DB test's runtime —
 * against ~15ms for the single statement.
 */
export const truncateAllTables = async (testDb: TestDb) => {
  const tables = await quotedTableList(testDb);
  if (tables.length === 0) return;
  await testDb.execute(sql.raw(`TRUNCATE TABLE ${tables} CASCADE`));
};

/**
 * A database that cannot answer: every query rejects.
 *
 * For tests of the "the database itself failed" path. Cheaper than closing a
 * real PGlite, whose `close()` takes about a second.
 */
export const createUnreachableDb = (): TestDb => {
  const down = () => Promise.reject(new Error("database is unreachable"));
  const client = { query: down, exec: down, transaction: down };
  return drizzle({ client: client as unknown as PGlite, schema });
};
