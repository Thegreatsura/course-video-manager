import { execFileSync } from "node:child_process";
import { Layer } from "effect";
import { GitWorktreeProbe } from "./services/drizzle-service.server.js";

/**
 * The ONE answer to "is this code running from a linked git worktree?" — used
 * by every database client built on this machine (`DrizzleService`, the
 * `apps/local/scripts` DB scripts, drizzle-kit) and by `cvm`'s local-only gate.
 *
 * A linked worktree is the case where git's private directory for this
 * checkout (`--git-dir`, `.git/worktrees/<name>`) differs from the shared one
 * (`--git-common-dir`, `.git`). In the main checkout they are the same.
 *
 * No git, or not a repository (a Vercel function, a tarball) is NOT a worktree:
 * every guard built on this is a no-op there.
 *
 * This file lives beside drizzle-guard.ts, outside the deployable build: it
 * shells out to git, which `@cvm/core` itself never does. The deployed
 * `apps/remote` provides `GitWorktreeProbe.NoCheckout` instead.
 */

export interface GitDirs {
  readonly gitDir: string;
  readonly commonDir: string;
}

/** Pure: does a pair of absolute git directories describe a linked worktree? */
export const isLinkedWorktree = (dirs: GitDirs): boolean =>
  dirs.gitDir.replace(/\/+$/, "") !== dirs.commonDir.replace(/\/+$/, "");

/** git's two directories for `cwd`, absolute; `undefined` without git or a repo. */
export const readGitDirs = (cwd: string): GitDirs | undefined => {
  try {
    const [gitDir, commonDir] = execFileSync(
      "git",
      ["rev-parse", "--path-format=absolute", "--git-dir", "--git-common-dir"],
      { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
    )
      .trim()
      .split("\n");
    if (!gitDir || !commonDir) return undefined;
    return { gitDir, commonDir };
  } catch {
    return undefined;
  }
};

const cache = new Map<string, boolean>();

/**
 * Whether the checkout at `cwd` is a linked worktree. Defaults to THIS
 * MODULE's checkout rather than the working directory: what matters is whose
 * code (and whose `.env`) is running, so the main checkout's globally-linked
 * `cvm` stays the main checkout wherever it is invoked from. Memoized per
 * directory — git is asked once per process.
 */
export const isInsideGitWorktree = (
  cwd: string = import.meta.dirname
): boolean => {
  let answer = cache.get(cwd);
  if (answer === undefined) {
    const dirs = readGitDirs(cwd);
    answer = dirs !== undefined && isLinkedWorktree(dirs);
    cache.set(cwd, answer);
  }
  return answer;
};

/** `DrizzleService`'s probe on a machine that may have a git checkout. */
export const GitWorktreeProbeLive = Layer.succeed(GitWorktreeProbe, {
  insideGitWorktree: () => isInsideGitWorktree(),
});
