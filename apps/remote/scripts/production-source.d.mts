// Types for production-source.mjs, which stays plain JS so the Vercel build
// runs it with no TypeScript step.

export type ProductionSourceInput = {
  vercelEnv: string | undefined;
  gitProvider: string | undefined;
  commitRef: string | undefined;
  commitSha: string | undefined;
  /** `git rev-parse HEAD` in the build, or null when there is no checkout. */
  checkoutHead: string | null;
};

export type ProductionSourceDecision = { ok: boolean; reason: string };

export declare const decideProductionSource: (
  input: ProductionSourceInput
) => ProductionSourceDecision;
