import {
  AGENT_SESSION_ENTRY_KINDS,
  FIELDS_OF_KIND,
  type AgentSessionEntryKind,
} from "./agent-session-entry.js";

/**
 * The content rules an Agent Session upload is held to before anything is
 * stored. Entries ship to learners in course.json from a PUBLIC pipeline, so
 * one problem anywhere refuses the WHOLE upload, and every problem is named
 * so the author can fix the session (or leave it out) and run it again.
 *
 * - No skill body and no tool result, ever: an entry carries only the fields
 *   its kind has (FIELDS_OF_KIND).
 * - No absolute local path: the reader turns paths under the session's
 *   working directory into project-relative ones first, so any left over
 *   point outside the project.
 * - No secret: token-shaped strings, `.env`-style assignments of keys and
 *   passwords, and URLs with credentials in them.
 */

/** Token shapes, each with the name a refusal reason gives it. */
const TOKEN_PATTERNS: ReadonlyArray<readonly [string, RegExp]> = [
  ["an API key (sk-…)", /\bsk-[A-Za-z0-9_-]{20,}/],
  ["a GitHub token", /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_\w{20,})/],
  ["a Slack token", /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ["an AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
  ["a Google API key", /\bAIza[0-9A-Za-z_-]{35}/],
  ["a JWT", /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ["a private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["a bearer token", /\bBearer\s+[A-Za-z0-9._~+/-]{20,}/],
  ["a URL with credentials", /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:[^\s/@]+@/i],
];

/** `NAME=value` where the name says it holds a secret, as in a `.env` file. */
const ENV_ASSIGNMENT =
  /^\s*(?:export\s+)?((?=[A-Z])[A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|PWD|CREDENTIALS?|DATABASE_URL|DSN)[A-Z0-9_]*)\s*=\s*["']?[^\s"']{6,}/m;

/**
 * An absolute path on the author's machine: a POSIX path under a top-level
 * directory a project never lives in relative to, a home-relative one, or a
 * Windows drive path. Not preceded by a URL's host or another path segment.
 */
const ABSOLUTE_LOCAL_PATH =
  /(?<![\w.:/~-])(?:\/(?:home|Users|mnt|root|tmp|var|etc|opt|srv|private|usr|Volumes)\/[^\s"'`)\]>]*|~\/[^\s"'`)\]>]*|[A-Za-z]:\\[^\s"'`)\]>]*)/;

const isKind = (value: unknown): value is AgentSessionEntryKind =>
  typeof value === "string" &&
  (AGENT_SESSION_ENTRY_KINDS as ReadonlyArray<string>).includes(value);

const textProblems = (where: string, value: string): string[] => {
  const problems: string[] = [];
  for (const [name, pattern] of TOKEN_PATTERNS) {
    if (pattern.test(value)) problems.push(`${where} holds ${name}`);
  }
  const env = ENV_ASSIGNMENT.exec(value);
  if (env) {
    problems.push(`${where} holds a .env-style value for ${env[1]}`);
  }
  const path = ABSOLUTE_LOCAL_PATH.exec(value);
  if (path) {
    problems.push(
      `${where} holds an absolute path outside the project: ${path[0]}`
    );
  }
  return problems;
};

/**
 * Every problem with these entries, as reasons a person can act on. Empty
 * means the upload may be stored. `label` names an entry in the reasons (its
 * session and position), and each entry is read as untyped data: an entry
 * that arrived over the wire with a field its kind lacks is caught here.
 */
export const findAgentSessionContentProblems = (
  entries: ReadonlyArray<{ readonly label: string; readonly entry: object }>
): string[] =>
  entries.flatMap(({ label, entry }) => {
    const fields = entry as Record<string, unknown>;
    const kind = fields.kind;
    if (!isKind(kind)) {
      return [`${label} has an unknown kind: ${String(kind)}`];
    }
    const allowed = new Set(["kind", ...FIELDS_OF_KIND[kind]]);
    const problems = Object.keys(fields)
      .filter((key) => !allowed.has(key))
      .map((key) =>
        key === "skillBody" || key === "result"
          ? `${label} (${kind}) carries a ${key}, which is never stored`
          : `${label} (${kind}) carries a field its kind does not have: ${key}`
      );
    for (const key of allowed) {
      const value = fields[key];
      if (typeof value === "string") {
        problems.push(...textProblems(`${label} (${kind}) ${key}`, value));
      }
    }
    return problems;
  });
