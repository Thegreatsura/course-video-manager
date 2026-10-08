import { vi } from "vitest";

/**
 * Every suite here runs as if from the main checkout.
 *
 * `isLocalMachine()` is false inside a git worktree whatever CVM_LOCAL_MACHINE
 * says, and agents run this suite from worktrees — so without this, every test
 * that sets CVM_LOCAL_MACHINE=true to exercise a local-only command would pass
 * for Matt and fail for an agent. The worktree detection itself is tested
 * against real git in packages/core/git-worktree.test.ts.
 */
vi.mock("@cvm/core/git-worktree", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@cvm/core/git-worktree")>()),
  isInsideGitWorktree: () => false,
}));
