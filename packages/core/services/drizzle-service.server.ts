import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import type { NodePgTransaction } from "drizzle-orm/node-postgres";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import { Pool } from "pg";
import * as schema from "../db/schema.js";
import { resolveDatabaseUrl } from "../db/database-url.js";
import {
  formatConnectionRefusal,
  judgeConnection,
} from "../db/connection-guard.js";
import { sqlStatementLogger } from "../db/sql-statement-log.js";
import { Context, Effect, Layer } from "effect";

export type DrizzleDB = NodePgDatabase<typeof schema>;

export type Database =
  | DrizzleDB
  | NodePgTransaction<typeof schema, ExtractTablesWithRelations<typeof schema>>;

/**
 * Whether this process runs from a linked git worktree — which `DrizzleService`
 * must know before it connects (see `../db/connection-guard.ts`). A required
 * dependency, not an optional one, so a layer that forgets to say fails to
 * build rather than connecting unguarded.
 *
 * `@cvm/core` cannot ask git itself, so the composition root provides it:
 * `GitWorktreeProbeLive` (`@cvm/core/git-worktree`) on the author's machine,
 * `GitWorktreeProbe.NoCheckout` on the deployed box, which has no git.
 */
export class GitWorktreeProbe extends Context.Tag("GitWorktreeProbe")<
  GitWorktreeProbe,
  { readonly insideGitWorktree: () => boolean }
>() {
  /** For a box with no git checkout (Vercel): never a worktree. */
  static readonly NoCheckout = Layer.succeed(GitWorktreeProbe, {
    insideGitWorktree: () => false,
  });
}

export class DrizzleService extends Effect.Service<DrizzleService>()(
  "DrizzleService",
  {
    effect: Effect.gen(function* () {
      // The pooled connection string. Migrations use the direct one instead —
      // see @/db/database-url.
      const url = resolveDatabaseUrl();
      if (!url) {
        return yield* Effect.die(
          new Error("DATABASE_URL is not set in environment variables")
        );
      }
      // A worktree never opens a writable connection to a remote database.
      const probe = yield* GitWorktreeProbe;
      const verdict = judgeConnection({
        url,
        env: process.env,
        insideGitWorktree: probe.insideGitWorktree,
      });
      if (!verdict.allowed) {
        return yield* Effect.die(new Error(formatConnectionRefusal(verdict)));
      }
      const logger = sqlStatementLogger();
      return drizzle(new Pool({ connectionString: url }), {
        schema,
        ...(logger ? { logger } : {}),
      }) as DrizzleDB;
    }),
  }
) {}
