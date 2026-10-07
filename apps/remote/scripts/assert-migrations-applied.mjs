// Fails the Vercel build when production has not applied this commit's latest
// migration, so a deploy that would read a column that does not exist yet is
// never promoted — the previous deployment keeps serving instead.
//
// Migrations are applied by hand (ADR 0026), so the database can be behind the
// code. PR #1859 proved it: it merged migration 0028 with code that selects the
// new column, and production broke until Matt migrated. The merge-side rule
// (docs/agents/merging.md) keeps that from merging; this is the backstop for
// anything that reaches `main` anyway.
//
// READ-ONLY. One SELECT on Drizzle's own bookkeeping table through the pooled
// `DATABASE_URL` the app already runs on. It never migrates: that is still only
// `pnpm db:migrate`, by hand, from main.
//
// Plain .mjs so it runs on whatever Node the Vercel build image has, with no
// TypeScript step. Not imported by the app, so Vercel never ships it.

import { readFileSync } from "node:fs";
import pg from "pg";

const journalUrl = new URL(
  "../../../packages/core/db/migrations/meta/_journal.json",
  import.meta.url
);
const entries = JSON.parse(readFileSync(journalUrl, "utf-8")).entries;
const latest = entries[entries.length - 1];

const fail = (message) => {
  console.error(`\nassert-migrations-applied: ${message}\n`);
  process.exit(1);
};

const url = process.env.DATABASE_URL;
if (!url) fail("DATABASE_URL is not set in the build environment.");

const client = new pg.Client({ connectionString: url });
let appliedUpTo;
try {
  await client.connect();
  // Drizzle's migrator records each migration's journal `when` as created_at
  // and applies only migrations newer than the newest one recorded.
  const result = await client.query(
    'SELECT max(created_at)::text AS max FROM "drizzle"."__drizzle_migrations"'
  );
  appliedUpTo = Number(result.rows[0]?.max ?? 0);
} catch (error) {
  fail(`could not read the migrations table: ${error.message}`);
} finally {
  await client.end().catch(() => {});
}

if (appliedUpTo < latest.when) {
  fail(
    [
      `production has not applied ${latest.tag}, which this commit's code expects.`,
      "Refusing to deploy code that would query schema that does not exist yet.",
      "Matt: from the main checkout, `git switch main && git pull --ff-only && pnpm db:migrate`, then redeploy.",
    ].join("\n")
  );
}

console.log(
  `assert-migrations-applied: production is at or past ${latest.tag}.`
);
