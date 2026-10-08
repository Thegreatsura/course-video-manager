import { describe, expect, it } from "vitest";
import { decideProductionSource } from "../apps/remote/scripts/production-source.mjs";

const SHA = "fa1eade47b73733d6312d5abfad33ce9e4068081";

// A production build Vercel cloned from GitHub's main — what a merge, and a
// `vercel redeploy` of a merge's deployment, both look like.
const mainFromGitHub = {
  vercelEnv: "production",
  gitProvider: "github",
  commitRef: "main",
  commitSha: SHA,
  checkoutHead: SHA,
};

describe("decideProductionSource", () => {
  it("passes a production build cloned from main", () => {
    expect(decideProductionSource(mainFromGitHub).ok).toBe(true);
  });

  it("passes preview builds whatever their source", () => {
    expect(
      decideProductionSource({
        vercelEnv: "preview",
        gitProvider: undefined,
        commitRef: undefined,
        commitSha: undefined,
        checkoutHead: null,
      }).ok
    ).toBe(true);
    expect(
      decideProductionSource({
        ...mainFromGitHub,
        vercelEnv: "preview",
        commitRef: "feature",
      }).ok
    ).toBe(true);
  });

  it("fails a production CLI upload with no git metadata", () => {
    const decision = decideProductionSource({
      vercelEnv: "production",
      gitProvider: undefined,
      commitRef: undefined,
      commitSha: undefined,
      checkoutHead: null,
    });
    expect(decision).toMatchObject({
      ok: false,
      reason: expect.stringContaining("no git metadata"),
    });
  });

  it("fails production from a branch other than main", () => {
    const decision = decideProductionSource({
      ...mainFromGitHub,
      commitRef: "my-worktree-branch",
    });
    expect(decision).toMatchObject({
      ok: false,
      reason: expect.stringContaining("my-worktree-branch"),
    });
  });

  it("fails a CLI upload that claims main but has no checkout", () => {
    // `vercel deploy --prod` from a dirty main checkout, or with
    // `--meta githubCommitRef=main`: right metadata, but .git is never uploaded.
    const decision = decideProductionSource({
      ...mainFromGitHub,
      checkoutHead: null,
    });
    expect(decision).toMatchObject({
      ok: false,
      reason: expect.stringContaining("no git checkout"),
    });
  });

  it("fails when the checkout is not the commit the metadata claims", () => {
    const decision = decideProductionSource({
      ...mainFromGitHub,
      checkoutHead: "0".repeat(40),
    });
    expect(decision.ok).toBe(false);
  });

  it("fails a provider other than github", () => {
    expect(
      decideProductionSource({ ...mainFromGitHub, gitProvider: "gitlab" }).ok
    ).toBe(false);
  });

  it("fails when any one piece of git metadata is missing", () => {
    for (const key of ["gitProvider", "commitRef", "commitSha"] as const) {
      expect(decideProductionSource({ ...mainFromGitHub, [key]: "" }).ok).toBe(
        false
      );
    }
  });
});
