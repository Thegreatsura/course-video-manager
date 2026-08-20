import { fileURLToPath } from "node:url";
import { defineConfig } from "drizzle-kit";
import { resolveMigrationDatabaseUrl } from "./db/database-url.js";

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
export default defineConfig({
  dialect: "postgresql",
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dbCredentials: {
    // Migrations run through the direct connection, never the pooler.
    url: resolveMigrationDatabaseUrl()!,
  },
  tablesFilter: ["course-video-manager_*"],
});
