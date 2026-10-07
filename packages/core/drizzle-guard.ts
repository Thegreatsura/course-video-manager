import { execFileSync } from "node:child_process";

/**
 * The guard in front of every drizzle-kit command that writes a schema
 * (`migrate`, `push`) to a database that is not on this machine.
 *
 * Why it exists: an unmerged branch once ran `db:migrate` against production.
 * Its `0004` migration carried a later timestamp than `main`'s real `0004`, so
 * Drizzle — which only applies migrations newer than the last one it recorded —
 * skipped `main`'s for months (PR #1836). Migrations are applied by hand
 * (ADR 0026), so the only thing that can stop that is the command itself.
 *
 * The rule: a remote target is migrated only from `main`, with a clean working
 * tree, at exactly the commit `origin/main` is at right now. A local target
 * (localhost, a socket, Docker's host alias) is never checked — tests, verify
 * clones and dev databases migrate as before.
 *
 * There is deliberately no override flag. Every legitimate production
 * migration — an emergency one included — can satisfy the rule by merging the
 * migration and running from a fresh `origin/main` worktree, and that is the
 * only path on which Drizzle's journal stays in order. An escape hatch would
 * also be one an agent can type for itself.
 *
 * This file lives beside drizzle.config.ts, outside the deployable build: it
 * shells out to git, which `@cvm/core` itself never does.
 */

/** drizzle-kit commands that change the target database's schema. */
const SCHEMA_WRITING_COMMANDS = new Set(["migrate", "push"]);

export const isSchemaWritingCommand = (argv: readonly string[]): boolean =>
  argv.slice(2).some((arg) => SCHEMA_WRITING_COMMANDS.has(arg));

/**
 * The host a connection string points at — never the credentials. `""` for a
 * Unix-socket URL (`postgresql:///db?host=/var/run/postgresql`); `undefined`
 * when the string is not a URL at all, which the guard treats as remote.
 */
export const parseHost = (url: string): string | undefined => {
  try {
    return new URL(url).hostname.replace(/^\[|\]$/g, "").toLowerCase();
  } catch {
    return undefined;
  }
};

export const isLocalHost = (host: string): boolean =>
  host === "" ||
  host === "localhost" ||
  host.endsWith(".localhost") ||
  host === "::1" ||
  host === "0.0.0.0" ||
  host === "host.docker.internal" ||
  /^127(\.\d{1,3}){3}$/.test(host);

export interface GitState {
  /** `HEAD` when detached. */
  readonly branch: string;
  /** No staged, unstaged or untracked changes — an untracked migration file is still applied. */
  readonly clean: boolean;
  readonly head: string;
  /** `origin/main` after a fetch; `undefined` if the fetch failed. */
  readonly originMain: string | undefined;
}

export type GuardVerdict =
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      /** Safe to print: a hostname, or a placeholder. Never the URL. */
      readonly host: string;
      readonly problems: readonly string[];
    };

/**
 * Decides whether a schema write to `url` may go ahead. `readGit` is only
 * called for a remote target, so a local migration never touches git or the
 * network.
 */
export const judgeSchemaWrite = (opts: {
  readonly url: string | undefined;
  readonly readGit: () => GitState;
}): GuardVerdict => {
  // No target: drizzle-kit refuses on its own, and there is nothing to protect.
  if (!opts.url) return { allowed: true };

  const host = parseHost(opts.url);
  if (host !== undefined && isLocalHost(host)) return { allowed: true };

  const git = opts.readGit();
  const problems: string[] = [];
  if (git.branch !== "main") {
    problems.push(`the current branch is '${git.branch}', not 'main'`);
  }
  if (!git.clean) {
    problems.push("the working tree has uncommitted or untracked changes");
  }
  if (git.originMain === undefined) {
    problems.push("could not fetch origin/main to compare against");
  } else if (git.head !== git.originMain) {
    problems.push(
      `HEAD (${git.head.slice(0, 8)}) is not origin/main (${git.originMain.slice(0, 8)})`
    );
  }

  if (problems.length === 0) return { allowed: true };
  return {
    allowed: false,
    host: host ?? "<unparseable connection string>",
    problems,
  };
};

export const formatRefusal = (
  verdict: Extract<GuardVerdict, { allowed: false }>
): string =>
  [
    `Refusing to write the schema of the remote database at ${verdict.host}:`,
    ...verdict.problems.map((p) => `  - ${p}`),
    "",
    "A remote database is migrated only from a clean `main` at exactly origin/main.",
    "Why: an unmerged branch once migrated production, and its out-of-order 0004 made",
    "Drizzle skip main's real 0004 for months (PR #1836).",
    "",
    "Merge the migration first, then run it from the main checkout:",
    "  git switch main && git pull --ff-only && pnpm db:migrate",
    "Local databases (localhost, 127.0.0.1, sockets, host.docker.internal) are never checked.",
    "See docs/adr/0026-migrations-applied-by-hand.md.",
  ].join("\n");

const git = (args: readonly string[], cwd: string): string =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

export const readGitState = (cwd: string): GitState => {
  let originMain: string | undefined;
  try {
    git(["fetch", "--quiet", "origin", "main"], cwd);
    originMain = git(["rev-parse", "origin/main"], cwd);
  } catch {
    originMain = undefined;
  }
  return {
    branch: git(["rev-parse", "--abbrev-ref", "HEAD"], cwd),
    clean: git(["status", "--porcelain"], cwd) === "",
    head: git(["rev-parse", "HEAD"], cwd),
    originMain,
  };
};

/**
 * Called from drizzle.config.ts, which every drizzle-kit command loads. Exits
 * the process before drizzle-kit connects if the write is not allowed.
 */
export const guardSchemaWrite = (opts: {
  readonly argv: readonly string[];
  readonly url: string | undefined;
  readonly cwd: string;
}): void => {
  if (!isSchemaWritingCommand(opts.argv)) return;
  const verdict = judgeSchemaWrite({
    url: opts.url,
    readGit: () => readGitState(opts.cwd),
  });
  if (verdict.allowed) return;
  console.error(`\n${formatRefusal(verdict)}\n`);
  process.exit(1);
};
