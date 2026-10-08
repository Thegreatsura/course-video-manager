// Brings a verify-cvm run's clone up to this checkout's schema. Called by
// `verify.sh launch` right after it clones the template and before the server
// starts; never run by hand.
//
//   node migrate-clone.mjs <clone url> <expected clone name>
//
// Why: the template (cvm_verify_template) only moves when Matt runs
// `pnpm db:verify-snapshot`, so after every merged migration it lags `main`,
// and a server whose schema expects a column the clone lacks 500s. This
// applies the checkout's packages/core/db/migrations that the clone lacks —
// to the clone only. The template is never connected to, let alone migrated.
//
// It uses Drizzle's migrator directly, not drizzle-kit, so drizzle-guard is not
// in the path; its own target check below is stricter than the guard's
// "local host" rule: localhost:5433, and exactly the run's cvm_verify_<id> clone.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const VERIFY_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const VERIFY_PORT = "5433";
const CLONE_NAME = /^cvm_verify_[0-9][0-9_]*$/;

const fail = (msg) => {
  console.error(`FAIL: migrate-clone: ${msg}`);
  process.exit(1);
};

/** The checked target, or a FAIL that names the host and database — never the password. */
const checkTarget = (rawUrl, expectedName) => {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    fail("the clone URL is not a URL — refusing to connect");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const db = decodeURIComponent(url.pathname.replace(/^\//, ""));
  const where = `${host}:${url.port || "(default port)"}/${db}`;
  if (!VERIFY_HOSTS.has(host) || url.port !== VERIFY_PORT) {
    fail(
      `refusing to migrate ${where} — only the local verify Postgres on localhost:${VERIFY_PORT} is migrated here`
    );
  }
  if (!CLONE_NAME.test(db)) {
    fail(
      `refusing to migrate ${where} — '${db}' is not a per-run clone (cvm_verify_<run id>); the template is never migrated`
    );
  }
  if (db !== expectedName) {
    fail(
      `refusing to migrate ${where} — this run's clone is '${expectedName}'`
    );
  }
  return url.toString();
};

const [rawUrl, expectedName] = process.argv.slice(2);
if (!rawUrl || !expectedName) {
  fail("usage: migrate-clone.mjs <clone url> <expected clone name>");
}
const cloneUrl = checkTarget(rawUrl, expectedName);

const repoRoot = join(import.meta.dirname, "../../../..");
const migrationsFolder = join(repoRoot, "packages/core/db/migrations");
// drizzle-orm and pg are @cvm/core's dependencies; resolve them from there.
const requireFromCore = createRequire(
  join(repoRoot, "packages/core/package.json")
);
const { Pool } = requireFromCore("pg");
const { drizzle } = requireFromCore("drizzle-orm/node-postgres");
const { migrate } = requireFromCore("drizzle-orm/node-postgres/migrator");

const journal = JSON.parse(
  readFileSync(join(migrationsFolder, "meta/_journal.json"), "utf8")
);

const pool = new Pool({ connectionString: cloneUrl, max: 1 });
try {
  // Drizzle applies every migration newer than the newest one recorded, so
  // that one timestamp is what decides "lacks".
  const newest = async () => {
    const { rows } = await pool.query(
      `select coalesce(max(created_at), 0)::bigint as at
         from drizzle.__drizzle_migrations`
    );
    return Number(rows[0].at);
  };
  const before = await newest().catch(() => 0);
  await migrate(drizzle(pool), { migrationsFolder });
  const after = await newest();
  const applied = journal.entries.filter(
    (e) => e.when > before && e.when <= after
  );
  if (applied.length === 0) {
    console.error(
      `migrate: ${expectedName} already has every migration in this checkout`
    );
  } else {
    console.error(
      `migrate: applied ${applied.length} migration(s) the template lacks, to ${expectedName} only:`
    );
    for (const e of applied) console.error(`  ${e.tag}`);
  }
} catch (e) {
  console.error(
    `FAIL: migrate-clone: migrating ${expectedName} failed: ${e instanceof Error ? e.message : String(e)}`
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
