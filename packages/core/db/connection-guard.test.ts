import { describe, expect, it, vi } from "vitest";
import { Cause, Effect, Exit, Layer } from "effect";
import {
  effectiveHost,
  formatConnectionRefusal,
  isReadOnlyConnection,
  judgeConnection,
} from "./connection-guard.js";
import {
  DrizzleService,
  GitWorktreeProbe,
} from "../services/drizzle-service.server.js";

// A fake remote host: nothing here ever opens a connection.
const REMOTE = "postgresql://user:s3cret@primary.example.invalid:5432/db";
const READ_ONLY = "-c default_transaction_read_only=on";

const judge = (
  url: string,
  opts: { worktree?: boolean; env?: Record<string, string> } = {}
) =>
  judgeConnection({
    url,
    env: opts.env ?? {},
    insideGitWorktree: () => opts.worktree ?? true,
  });

describe("judgeConnection", () => {
  it("refuses a writable remote connection from a worktree, naming only the host", () => {
    const verdict = judge(REMOTE);
    expect(verdict).toEqual({
      allowed: false,
      host: "primary.example.invalid",
    });
    if (verdict.allowed) throw new Error("unreachable");
    const message = formatConnectionRefusal(verdict);
    expect(message).toContain("git worktree");
    expect(message).toContain("verify.sh launch");
    expect(message).not.toContain("s3cret");
  });

  it("allows the same connection outside a worktree (the main checkout, Vercel)", () => {
    expect(judge(REMOTE, { worktree: false })).toEqual({ allowed: true });
  });

  it.each([
    "postgresql://u:p@localhost:5433/cvm_verify_x",
    "postgresql://u:p@127.0.0.1/db",
    "postgresql://u:p@host.docker.internal/db",
    "postgresql:///db?host=/var/run/postgresql",
  ])("allows local %s without asking git", (url) => {
    const verdict = judgeConnection({
      url,
      env: {},
      insideGitWorktree: () => {
        throw new Error("git must not be asked for a local host");
      },
    });
    expect(verdict).toEqual({ allowed: true });
  });

  it("allows a read-only connection from a worktree (verify-cvm launch --production)", () => {
    expect(judge(REMOTE, { env: { PGOPTIONS: READ_ONLY } })).toEqual({
      allowed: true,
    });
  });

  it("treats an unparseable connection string as remote", () => {
    expect(judge("not a url")).toEqual({
      allowed: false,
      host: "<unparseable connection string>",
    });
  });
});

describe("effectiveHost", () => {
  it("falls back to ?host= and PGHOST when the URL has no hostname", () => {
    expect(effectiveHost("postgresql:///db?host=db.example.invalid", {})).toBe(
      "db.example.invalid"
    );
    expect(
      effectiveHost("postgresql:///db", { PGHOST: "db.example.invalid" })
    ).toBe("db.example.invalid");
    expect(effectiveHost("postgresql:///db", {})).toBe("");
  });
});

describe("isReadOnlyConnection", () => {
  it.each([
    READ_ONLY,
    "-cdefault_transaction_read_only=on",
    "--default-transaction-read-only=true",
    "-c statement_timeout=0 -c default_transaction_read_only=ON",
  ])("reads PGOPTIONS %s as read-only", (PGOPTIONS) => {
    expect(isReadOnlyConnection(REMOTE, { PGOPTIONS })).toBe(true);
  });

  it.each([
    undefined,
    "",
    "-c default_transaction_read_only=off",
    `${READ_ONLY} -c default_transaction_read_only=off`,
    "-c client_min_messages=warning",
  ])("reads PGOPTIONS %s as writable", (PGOPTIONS) => {
    expect(isReadOnlyConnection(REMOTE, { PGOPTIONS })).toBe(false);
  });

  it("prefers the URL's options over PGOPTIONS, as node-postgres does", () => {
    const withOptions = `${REMOTE}?options=${encodeURIComponent("-c search_path=x")}`;
    expect(isReadOnlyConnection(withOptions, { PGOPTIONS: READ_ONLY })).toBe(
      false
    );
    const readOnlyUrl = `${REMOTE}?options=${encodeURIComponent(READ_ONLY)}`;
    expect(isReadOnlyConnection(readOnlyUrl, {})).toBe(true);
  });
});

describe("DrizzleService", () => {
  const build = (insideGitWorktree: boolean) => {
    vi.stubEnv("DATABASE_URL", REMOTE);
    try {
      return Effect.runSyncExit(
        Effect.scoped(
          Layer.build(
            DrizzleService.Default.pipe(
              Layer.provide(
                Layer.succeed(GitWorktreeProbe, {
                  insideGitWorktree: () => insideGitWorktree,
                })
              )
            )
          )
        )
      );
    } finally {
      vi.unstubAllEnvs();
    }
  };

  it("refuses to build against a remote host from a worktree", () => {
    const exit = build(true);
    if (!Exit.isFailure(exit)) throw new Error("expected a refusal");
    expect(Cause.pretty(exit.cause)).toContain(
      "Refusing to connect to the remote database"
    );
  });

  it("builds against the same host outside a worktree (the pool is lazy: no connection)", () => {
    expect(Exit.isSuccess(build(false))).toBe(true);
  });
});
