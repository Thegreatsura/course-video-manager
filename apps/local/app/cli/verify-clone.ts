import { effectiveHost } from "@cvm/core/db/connection-guard";

/**
 * Verify-clone mode: `cvm` run by `verify.sh cvm <run> …` against ONE
 * verify-cvm run's test clone, from a worktree.
 *
 * A worktree is never the author's machine (see `isLocalMachine`), and `cvm`'s
 * transport normally points at the deployed API — production. So an agent
 * checking a `cvm` change from its worktree could run neither the local-only
 * verbs nor anything else without touching production. Verify-clone mode is the
 * one sanctioned way round that, and it is shaped so that it can only ever
 * reach the clone:
 *
 *   - `CVM_VERIFY_CLONE` names the clone, and must look like a per-run clone
 *     (`cvm_verify_<run id>`) — never the template, never anything else.
 *   - `CVM_API_URL` must be plain http on a LOOPBACK address: the run's own
 *     `apps/remote`, which `verify.sh` starts on 127.0.0.1 against the clone.
 *     The deployed API is never loopback, so it is refused.
 *   - `DATABASE_URL` must be on a loopback host and name that same clone.
 *
 * Any one of these wrong and the mode is refused outright — `cvm` exits before
 * it sends a request, and the local-only gate stays shut. Nothing here changes
 * what happens when `CVM_VERIFY_CLONE` is unset: the author's machine and every
 * Remote Box keep the gates they had.
 */

export const VERIFY_CLONE_ENV_KEY = "CVM_VERIFY_CLONE";

/** A per-run clone's name, as verify-db.sh's `clone_name_for` makes it. */
const CLONE_NAME_RE = /^cvm_verify_[0-9][0-9_]*$/;

/**
 * Loopback only. Narrower than the connection guard's `isLocalHost` on
 * purpose: `0.0.0.0` and Docker's host alias are not "this process's own
 * machine, nobody else's" in the sense this mode needs.
 */
export const isLoopbackHost = (host: string): boolean =>
  host === "localhost" || host === "::1" || /^127(\.\d{1,3}){3}$/.test(host);

export interface VerifyCloneEnv {
  readonly clone: string | undefined;
  readonly apiUrl: string | undefined;
  readonly databaseUrl: string | undefined;
}

export type VerifyCloneVerdict =
  | { readonly ok: true; readonly clone: string }
  | { readonly ok: false; readonly reason: string };

const refuse = (reason: string): VerifyCloneVerdict => ({ ok: false, reason });

/** Is this a loopback http(s) URL? The reason it is not, otherwise. */
export const loopbackUrlProblem = (
  url: string | undefined
): string | undefined => {
  if (url === undefined || url === "") return "it is not set";
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return `"${url}" is not a URL`;
  }
  if (parsed.protocol !== "http:")
    return `${parsed.protocol} is not plain http — the run's API is http on loopback`;
  const host = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!isLoopbackHost(host))
    return `its host "${host}" is not loopback (127.0.0.1, localhost or ::1)`;
  return undefined;
};

/**
 * Pure: the verdict on a verify-clone environment. Every check must pass; the
 * first that fails is named, so a refusal says what to fix.
 */
export const checkVerifyClone = (env: VerifyCloneEnv): VerifyCloneVerdict => {
  const clone = env.clone?.trim();
  if (!clone) return refuse(`${VERIFY_CLONE_ENV_KEY} is not set`);
  if (!CLONE_NAME_RE.test(clone))
    return refuse(
      `${VERIFY_CLONE_ENV_KEY}="${clone}" is not a per-run verify-cvm clone (cvm_verify_<run id>)`
    );

  const apiProblem = loopbackUrlProblem(env.apiUrl);
  if (apiProblem !== undefined)
    return refuse(`CVM_API_URL is not the run's own API: ${apiProblem}`);

  const db = env.databaseUrl;
  if (!db) return refuse("DATABASE_URL is not set — it must name the clone");
  const host = effectiveHost(db, {});
  if (host === undefined) return refuse("DATABASE_URL is not a URL");
  if (!isLoopbackHost(host))
    return refuse(`DATABASE_URL's host "${host}" is not loopback`);
  const dbName = decodeURIComponent(new URL(db).pathname.replace(/^\//, ""));
  if (dbName !== clone)
    return refuse(`DATABASE_URL names "${dbName}", not the clone ${clone}`);

  return { ok: true, clone };
};

/** Whether verify-clone mode has been asked for at all. */
export const verifyCloneRequested = (
  env: NodeJS.ProcessEnv = process.env
): boolean => (env[VERIFY_CLONE_ENV_KEY]?.trim() ?? "") !== "";

/** The verdict for this process's own environment. */
export const verifyCloneFromEnv = (
  env: NodeJS.ProcessEnv = process.env
): VerifyCloneVerdict =>
  checkVerifyClone({
    clone: env[VERIFY_CLONE_ENV_KEY],
    apiUrl: env.CVM_API_URL,
    databaseUrl: env.DATABASE_URL,
  });
