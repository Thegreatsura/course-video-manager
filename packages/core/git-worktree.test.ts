import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  isInsideGitWorktree,
  isLinkedWorktree,
  readGitDirs,
} from "./git-worktree.js";

describe("isLinkedWorktree", () => {
  it("is false when git's own and common directories agree", () => {
    expect(isLinkedWorktree({ gitDir: "/r/.git", commonDir: "/r/.git/" })).toBe(
      false
    );
  });

  it("is true when the checkout has its own directory under worktrees/", () => {
    expect(
      isLinkedWorktree({ gitDir: "/r/.git/worktrees/x", commonDir: "/r/.git" })
    ).toBe(true);
  });
});

describe("isInsideGitWorktree — against real git", () => {
  let root: string;
  // Hermetic: no GIT_DIR or the like leaking in from a calling hook.
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))
  );
  const git = (cwd: string, ...args: string[]) =>
    execFileSync("git", args, { cwd, env, stdio: "ignore" });

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "cvm-git-worktree-"));
    const main = join(root, "main");
    mkdirSync(main);
    git(main, "init", "-q", "-b", "main");
    git(
      main,
      "-c",
      "user.email=t@t",
      "-c",
      "user.name=t",
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "x"
    );
    git(main, "worktree", "add", "-q", join(root, "linked"), "-b", "linked");
    mkdirSync(join(main, "nested"));
    mkdirSync(join(root, "linked", "nested"));
    mkdirSync(join(root, "no-git"));
  });

  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it("the main checkout is not a worktree, from any depth", () => {
    expect(isInsideGitWorktree(join(root, "main"))).toBe(false);
    expect(isInsideGitWorktree(join(root, "main", "nested"))).toBe(false);
  });

  it("a linked worktree is, from any depth", () => {
    expect(isInsideGitWorktree(join(root, "linked"))).toBe(true);
    expect(isInsideGitWorktree(join(root, "linked", "nested"))).toBe(true);
  });

  it("no repository at all (a deployed box) is not a worktree", () => {
    expect(readGitDirs(join(root, "no-git"))).toBeUndefined();
    expect(isInsideGitWorktree(join(root, "no-git"))).toBe(false);
  });

  it("a missing directory is not a worktree either", () => {
    expect(isInsideGitWorktree(join(root, "does-not-exist"))).toBe(false);
  });
});
