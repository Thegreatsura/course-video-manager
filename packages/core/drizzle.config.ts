import { fileURLToPath } from "node:url";
import { defineConfig } from "drizzle-kit";
import { resolveMigrationDatabaseUrl } from "./db/database-url.js";
import {
  formatConnectionRefusal,
  judgeConnection,
} from "./db/connection-guard.js";
import { guardSchemaWrite } from "./drizzle-guard.js";
import { isInsideGitWorktree } from "./git-worktree.js";

/**
 * drizzle-kit runs in THIS package, but the author's environment lives in the
 * .env at the repo root — one file for the whole monorepo. Nothing loads it for
 * a bare binary, so load it here. A missing file is not an error: on a deployed
 * box the variables are real environment variables and there is no .env.
 */
try {
  process.loadEnvFile(fileURLToPath(new URL("../../.env", import.meta.url)));
} catch {
  // No .env — the environment supplies the variables directly.
}

/**
 * The schema, the migrations and the tooling that reads them live TOGETHER, in
 * the package that owns them. `apps/local` held this config while it also held
 * the schema; it no longer holds either.
 *
 * Generating a migration (`db:generate`) is authoring, done on the author's
 * machine. APPLYING one (`db:migrate`) is also done by hand, from the root
 * (`pnpm db:migrate`) — the `apps/remote` deploy no longer runs it, because
 * that ran on every Vercel build, previews included, and could land an
 * unmerged migration on the production schema. See ADR 0026 and
 * apps/remote/README.md.
 */
const url = resolveMigrationDatabaseUrl();

/**
 * `migrate` and `push` against a remote database only from a clean `main` at
 * origin/main — an unmerged branch once migrated production out of order
 * (PR #1836). Local databases are never checked. See drizzle-guard.ts.
 */
guardSchemaWrite({
  argv: process.argv,
  url,
  cwd: fileURLToPath(new URL(".", import.meta.url)),
});

/**
 * Every drizzle-kit command that opens a connection (`studio` writes rows too)
 * goes through the same rule as every other client: no writable connection to
 * a remote database from a git worktree. See db/connection-guard.ts.
 */
const CONNECTING_COMMANDS = new Set([
  "migrate",
  "push",
  "studio",
  "pull",
  "introspect",
]);
if (url && process.argv.slice(2).some((arg) => CONNECTING_COMMANDS.has(arg))) {
  const verdict = judgeConnection({
    url,
    env: process.env,
    insideGitWorktree: () => isInsideGitWorktree(),
  });
  if (!verdict.allowed) {
    console.error(`\n${formatConnectionRefusal(verdict)}\n`);
    process.exit(1);
  }
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dbCredentials: {
    // Migrations run through the direct connection, never the pooler.
    url: url!,
  },
  tablesFilter: ["course-video-manager_*"],
});
