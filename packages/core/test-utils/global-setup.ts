import { pushSchema } from "drizzle-kit/api";
import type { TestProject } from "vitest/node";
import * as schema from "../db/schema.js";
import {
  connectAdmin,
  DB_PREFIX,
  dropDatabasesWithPrefix,
  dropOrphanedDatabases,
  machineTag,
  makeTestPool,
  startTestServer,
  testDrizzle,
  urlForDatabase,
} from "./test-postgres.js";
import "./test-db-context.js";

let serverUrl: string | undefined;
let runPrefix: string | undefined;

/**
 * Once per run: make sure the test Postgres is up, then build this run's
 * TEMPLATE database — the schema pushed once. Every `createTestDb()` is then a
 * `CREATE DATABASE … TEMPLATE` clone of it, which copies files rather than
 * replaying DDL (ADR 0046).
 */
export default async function setup(project: TestProject) {
  serverUrl = await startTestServer();
  runPrefix = `${DB_PREFIX}${machineTag}_${process.pid}_`;
  const template = `${runPrefix}template`;

  const admin = await connectAdmin(serverUrl);
  try {
    await dropOrphanedDatabases(admin);
    await dropDatabasesWithPrefix(admin, runPrefix);
    await admin.query(`CREATE DATABASE "${template}"`);
  } finally {
    await admin.end();
  }

  const pool = makeTestPool(urlForDatabase(serverUrl, template), 1);
  try {
    const { apply } = await pushSchema(schema, testDrizzle(pool) as any);
    await apply();
  } finally {
    await pool.end();
  }

  project.provide("testDatabase", { serverUrl, runPrefix, template });
  // Returned, not exported: vitest ignores a named `teardown` export when the
  // file has a default export.
  return teardown;
}

async function teardown() {
  if (!serverUrl || !runPrefix) return;
  try {
    const admin = await connectAdmin(serverUrl);
    try {
      await dropDatabasesWithPrefix(admin, runPrefix);
    } finally {
      await admin.end();
    }
  } catch {
    // The next run's orphan sweep drops whatever this one could not.
  }
}
