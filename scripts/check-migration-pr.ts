// A migration ships alone, and the code that needs it ships only once Matt has
// applied it to production (expand/contract — see docs/agents/merging.md).
//
// Why: migrations are applied by hand (ADR 0026), but `apps/remote` deploys on
// merge. PR #1859 shipped migration 0028 together with code that selects the new
// column, an agent merged it on a green `check`, and production read a column
// that did not exist until Matt migrated. Two rules make that impossible:
//
// 1. `migration-only` — a PR that adds or changes anything under
//    `packages/core/db/migrations/` may change nothing else except
//    `packages/core/db/migrations.test.ts` and `docs/`. That includes the Drizzle
//    schema: a column in `schema.ts` is a column every `select()` of that table
//    reads, so the schema is code that depends on the migration.
// 2. `migration-applied` — a PR that changes the Drizzle schema needs the
//    `migration-applied` label, which Matt adds after `pnpm db:migrate` has run
//    against production. It attests that every migration on `main` is applied.
//    An agent never adds it (a Claude Code hook blocks it, too).
//
// CI-only: it judges a PR's changed files and labels, which a local checkout
// does not have. Usage (see .github/workflows/test.yml):
//   node scripts/check-migration-pr.ts --files <file> --labels <file>
// Each file is newline-separated. Exit 1 with the reasons on a violation.

import { readFileSync } from "node:fs";

export const MIGRATIONS_DIR = "packages/core/db/migrations/";
export const APPLIED_LABEL = "migration-applied";

/** Files that may change alongside a migration. */
const allowedWithMigration = (file: string): boolean =>
  file.startsWith(MIGRATIONS_DIR) ||
  file === "packages/core/db/migrations.test.ts" ||
  file.startsWith("docs/");

/** The Drizzle schema: `schema.ts` and the files it re-exports tables from. */
export const SCHEMA_FILES: readonly string[] = [
  "packages/core/db/schema.ts",
  "packages/core/db/schema-auth.ts",
  "packages/core/db/schema-api-token.ts",
];

export type Verdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly problems: readonly string[] };

/**
 * `files` is every path the PR touches — both sides of a rename. `labels` are
 * the PR's labels as they are now, not as they were when the run was queued.
 */
export const judgeMigrationPr = (opts: {
  readonly files: readonly string[];
  readonly labels: readonly string[];
}): Verdict => {
  const problems: string[] = [];

  const migrations = opts.files.filter((f) => f.startsWith(MIGRATIONS_DIR));
  const others = opts.files.filter((f) => !allowedWithMigration(f));
  if (migrations.length > 0 && others.length > 0) {
    problems.push(
      [
        `migration-only: this PR changes a migration (${migrations.join(", ")}) and also:`,
        ...others.map((f) => `  - ${f}`),
        "A migration ships in a PR of its own (the migration files, migrations.test.ts and docs/ only).",
        "Move everything else — schema.ts included — into a follow-up PR that merges after Matt has applied the migration.",
      ].join("\n")
    );
  }

  const schema = opts.files.filter((f) => SCHEMA_FILES.includes(f));
  if (schema.length > 0 && !opts.labels.includes(APPLIED_LABEL)) {
    problems.push(
      [
        `migration-applied: this PR changes the Drizzle schema (${schema.join(", ")}) and has no \`${APPLIED_LABEL}\` label.`,
        "Code that reads a new column may merge only after the migration that adds it is applied to production.",
        `Matt adds \`${APPLIED_LABEL}\` once \`pnpm db:migrate\` has run, then re-runs this check. Agents never add it: stop and hand the PR to Matt.`,
      ].join("\n")
    );
  }

  return problems.length === 0 ? { ok: true } : { ok: false, problems };
};

const readLines = (path: string): string[] =>
  readFileSync(path, "utf-8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "");

const main = (argv: readonly string[]): void => {
  const arg = (name: string): string => {
    const i = argv.indexOf(name);
    const value = i === -1 ? undefined : argv[i + 1];
    if (value === undefined) {
      console.error(
        `usage: check-migration-pr.ts --files <file> --labels <file>`
      );
      process.exit(2);
    }
    return value;
  };
  const verdict = judgeMigrationPr({
    files: readLines(arg("--files")),
    labels: readLines(arg("--labels")),
  });
  if (verdict.ok) {
    console.log("migration guard: ok");
    return;
  }
  for (const problem of verdict.problems)
    console.error(`::error::${problem.split("\n")[0]}\n${problem}\n`);
  process.exit(1);
};

if (import.meta.url === `file://${process.argv[1]}`)
  main(process.argv.slice(2));
