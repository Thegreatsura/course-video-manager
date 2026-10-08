// The decision behind assert-production-source.mjs, kept pure so it can be
// unit-tested (tests/production-source.test.ts) without a Vercel build.
//
// A production build must come from GitHub's `main`, cloned by Vercel. Two
// signals together tell that apart from a `vercel deploy --prod` CLI upload:
//
// 1. Git metadata: VERCEL_GIT_PROVIDER, VERCEL_GIT_COMMIT_REF and
//    VERCEL_GIT_COMMIT_SHA. A CLI upload from a git checkout can carry these
//    too (the CLI reads the local branch, and `--meta githubCommitRef=…` can
//    set them), so on their own they are not enough.
// 2. A real checkout: Vercel clones git-sourced builds (`git clone --depth=10`)
//    and the CLI never uploads `.git` (it is on Vercel's always-ignored list).
//    So `git rev-parse HEAD` only answers in a cloned build, and it must equal
//    the commit the metadata claims.
//
// `vercel redeploy` of a main deployment rebuilds from the original's
// gitSource, so it is cloned again and passes both.

/**
 * @param {{
 *   vercelEnv: string | undefined,
 *   gitProvider: string | undefined,
 *   commitRef: string | undefined,
 *   commitSha: string | undefined,
 *   checkoutHead: string | null,
 * }} input
 * @returns {{ ok: true, reason: string } | { ok: false, reason: string }}
 */
export const decideProductionSource = ({
  vercelEnv,
  gitProvider,
  commitRef,
  commitSha,
  checkoutHead,
}) => {
  if (vercelEnv !== "production") {
    return {
      ok: true,
      reason: `not a production build (VERCEL_ENV=${vercelEnv ?? "unset"}).`,
    };
  }
  if (!gitProvider || !commitRef || !commitSha) {
    return {
      ok: false,
      reason:
        "production build has no git metadata (VERCEL_GIT_PROVIDER, VERCEL_GIT_COMMIT_REF, VERCEL_GIT_COMMIT_SHA), so it was not built from GitHub. A CLI upload cannot go to production.",
    };
  }
  if (gitProvider !== "github") {
    return {
      ok: false,
      reason: `production build came from git provider "${gitProvider}", not github.`,
    };
  }
  if (commitRef !== "main") {
    return {
      ok: false,
      reason: `production build is from branch "${commitRef}", not main. Land it through a PR.`,
    };
  }
  if (checkoutHead === null) {
    return {
      ok: false,
      reason:
        "production build claims main but has no git checkout, so its files were uploaded by the Vercel CLI rather than cloned from GitHub. A CLI upload cannot go to production.",
    };
  }
  if (checkoutHead !== commitSha) {
    return {
      ok: false,
      reason: `production build's checkout is at ${checkoutHead}, but its metadata claims ${commitSha}.`,
    };
  }
  return {
    ok: true,
    reason: `production build is main at ${commitSha}, cloned from GitHub.`,
  };
};
