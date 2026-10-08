/**
 * The rule every database client this repo builds goes through before it
 * connects: **a git worktree never opens a writable connection to a remote
 * database.**
 *
 * Why: a worktree is unmerged code, and worktrees have been made with the main
 * checkout's `.env` copied or symlinked in — which points at production. From
 * there `pnpm dev`, the `db:*` scripts and anything built on `DrizzleService`
 * read and write production from a branch nobody has reviewed.
 *
 * The verdict, in order:
 *
 * 1. A local host (localhost, a socket, Docker's host alias) — allowed. Tests,
 *    verify-cvm clones and dev databases are never checked, and git is never
 *    asked.
 * 2. A read-only connection — allowed. `default_transaction_read_only=on` in
 *    the connection's options (the URL's `options` parameter, else
 *    `PGOPTIONS`) is how `verify-cvm launch --production` looks at production
 *    without being able to write to it. This is the ONLY exception.
 * 3. Otherwise refused if the process runs inside a git worktree.
 *
 * Pure: whether this is a worktree is asked through `insideGitWorktree`, so
 * this file stays deployable. On a box with no git (Vercel, `apps/remote`) the
 * probe says "no", and the guard is a no-op.
 */

/**
 * The host a connection string points at — never the credentials. `""` for a
 * Unix-socket URL (`postgresql:///db?host=/var/run/postgresql`); `undefined`
 * when the string is not a URL at all, which every guard treats as remote.
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

/** The libpq-style environment node-postgres falls back to. */
export interface ConnectionEnv {
  readonly PGHOST?: string | undefined;
  readonly PGOPTIONS?: string | undefined;
}

/**
 * The host node-postgres will actually dial: the URL's hostname, else its
 * `?host=` parameter, else `PGHOST`. A socket directory counts as `""` (local).
 * `undefined` when the URL does not parse.
 */
export const effectiveHost = (
  url: string,
  env: ConnectionEnv
): string | undefined => {
  const hostname = parseHost(url);
  if (hostname === undefined) return undefined;
  const fallback =
    hostname || new URL(url).searchParams.get("host") || env.PGHOST || "";
  return fallback.startsWith("/")
    ? ""
    : fallback.replace(/^\[|\]$/g, "").toLowerCase();
};

const TRUTHY = new Set(["on", "true", "yes", "1"]);

/**
 * Whether the connection's server options switch every transaction to
 * read-only. node-postgres takes `options` from the URL when it has one and
 * from `PGOPTIONS` otherwise — never both — so this reads them in that order.
 * The LAST `default_transaction_read_only` setting wins, as it does in
 * Postgres.
 */
export const isReadOnlyConnection = (
  url: string,
  env: ConnectionEnv
): boolean => {
  let options: string | undefined;
  try {
    options = new URL(url).searchParams.get("options") || undefined;
  } catch {
    return false;
  }
  options ??= env.PGOPTIONS;
  if (!options) return false;
  const settings = [
    ...options.matchAll(
      /(?:^|\s)(?:-c\s*|--)default[_-]transaction[_-]read[_-]only\s*=\s*([^\s]+)/gi
    ),
  ];
  const last = settings.at(-1)?.[1];
  return (
    last !== undefined && TRUTHY.has(last.replace(/['"]/g, "").toLowerCase())
  );
};

export type ConnectionVerdict =
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      /** Safe to print: a hostname, or a placeholder. Never the URL. */
      readonly host: string;
    };

export const judgeConnection = (opts: {
  readonly url: string;
  readonly env: ConnectionEnv;
  /** Only called for a writable connection to a remote host. */
  readonly insideGitWorktree: () => boolean;
}): ConnectionVerdict => {
  const host = effectiveHost(opts.url, opts.env);
  if (host !== undefined && isLocalHost(host)) return { allowed: true };
  if (isReadOnlyConnection(opts.url, opts.env)) return { allowed: true };
  if (!opts.insideGitWorktree()) return { allowed: true };
  return {
    allowed: false,
    host: host ?? "<unparseable connection string>",
  };
};

export const formatConnectionRefusal = (
  verdict: Extract<ConnectionVerdict, { allowed: false }>
): string =>
  [
    `Refusing to connect to the remote database at ${verdict.host}: this process runs inside a git worktree.`,
    "A worktree is unmerged code. Its .env (copied or symlinked from the main checkout) points at",
    "production, so this connection would read and write production from an unreviewed branch.",
    "",
    "Use instead:",
    "  - a verify-cvm clone, a writable copy of Matt's data that needs no .env:",
    "      .claude/skills/verify-cvm/scripts/verify.sh launch",
    "  - any local database: DATABASE_URL=postgresql://…@localhost:…/…",
    "  - to only LOOK at production: verify.sh launch --production, whose connections are",
    "    read-only (PGOPTIONS='-c default_transaction_read_only=on') — the one exception.",
    "Then delete this worktree's .env. Production is reached from the main checkout only.",
  ].join("\n");
