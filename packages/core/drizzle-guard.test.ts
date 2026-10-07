import { describe, expect, it } from "vitest";
import {
  formatRefusal,
  type GitState,
  isSchemaWritingCommand,
  judgeSchemaWrite,
  parseHost,
} from "./drizzle-guard.js";

const REMOTE = "postgresql://user:s3cret@primary.example.psdb.cloud:5432/db";
const SHA = "a".repeat(40);
const OTHER_SHA = "b".repeat(40);

const ON_MAIN: GitState = {
  branch: "main",
  clean: true,
  head: SHA,
  originMain: SHA,
};

const judge = (url: string | undefined, git: Partial<GitState> = {}) =>
  judgeSchemaWrite({ url, readGit: () => ({ ...ON_MAIN, ...git }) });

describe("judgeSchemaWrite — local targets are never checked", () => {
  it.each([
    "postgresql://u:p@localhost:5432/db",
    "postgresql://u:p@LOCALHOST/db",
    "postgresql://u:p@127.0.0.1:5433/db",
    "postgresql://u:p@127.1.2.3/db",
    "postgresql://u:p@[::1]:5432/db",
    "postgresql://u:p@0.0.0.0/db",
    "postgresql://u:p@host.docker.internal:5432/db",
    "postgresql://u:p@cvm.localhost/db",
    "postgresql:///db?host=/var/run/postgresql",
  ])("allows %s without reading git", (url) => {
    const verdict = judgeSchemaWrite({
      url,
      readGit: () => {
        throw new Error("git must not be read for a local target");
      },
    });
    expect(verdict).toEqual({ allowed: true });
  });

  it("allows a missing URL — drizzle-kit refuses that on its own", () => {
    expect(judge(undefined, { branch: "feature" })).toEqual({ allowed: true });
  });
});

describe("judgeSchemaWrite — remote targets", () => {
  it("allows a clean main at origin/main", () => {
    expect(judge(REMOTE)).toEqual({ allowed: true });
  });

  it.each<[string, Partial<GitState>, RegExp]>([
    ["a feature branch", { branch: "fix/lint" }, /'fix\/lint', not 'main'/],
    ["a detached HEAD", { branch: "HEAD" }, /'HEAD', not 'main'/],
    ["a dirty tree", { clean: false }, /uncommitted or untracked/],
    ["HEAD behind/ahead of origin", { head: OTHER_SHA }, /is not origin\/main/],
    ["a failed fetch", { originMain: undefined }, /could not fetch/],
  ])("refuses %s", (_, git, problem) => {
    const verdict = judge(REMOTE, git);
    expect(verdict.allowed).toBe(false);
    if (verdict.allowed) return;
    expect(verdict.problems).toHaveLength(1);
    expect(verdict.problems[0]).toMatch(problem);
  });

  it("lists every problem at once", () => {
    const verdict = judge(REMOTE, {
      branch: "fix/lint",
      clean: false,
      head: OTHER_SHA,
    });
    expect(verdict.allowed).toBe(false);
    if (verdict.allowed) return;
    expect(verdict.problems).toHaveLength(3);
  });

  it("treats an unparseable connection string as remote", () => {
    const verdict = judge("not a url", { branch: "feature" });
    expect(verdict).toMatchObject({
      allowed: false,
      host: "<unparseable connection string>",
    });
  });

  it("does not let a local-looking hostname prefix through", () => {
    expect(
      judge("postgresql://u:p@localhost.evil.com/db", { branch: "x" })
    ).toMatchObject({ allowed: false, host: "localhost.evil.com" });
  });

  it("names the host but never prints credentials", () => {
    const verdict = judge(REMOTE, { branch: "feature" });
    if (verdict.allowed) throw new Error("expected a refusal");
    const message = formatRefusal(verdict);
    expect(message).toContain("primary.example.psdb.cloud");
    expect(message).toContain("PR #1836");
    expect(message).not.toContain("s3cret");
    expect(message).not.toContain("user:");
  });
});

describe("parseHost", () => {
  it("returns only the hostname", () => {
    expect(parseHost(REMOTE)).toBe("primary.example.psdb.cloud");
  });
});

describe("isSchemaWritingCommand", () => {
  it.each([
    [["node", "drizzle-kit", "migrate"], true],
    [["node", "drizzle-kit", "push", "--force"], true],
    [["node", "drizzle-kit", "generate"], false],
    [["node", "drizzle-kit", "studio"], false],
    [["node", "vitest", "run"], false],
  ])("%j → %s", (argv, expected) => {
    expect(isSchemaWritingCommand(argv)).toBe(expected);
  });
});
