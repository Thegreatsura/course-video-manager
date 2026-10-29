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
 * - No secret: token-shaped strings, `.env`-style assignments of keys and
 *   passwords, and URLs with credentials in them. A kebab-case slug
 *   (`sk-learn-the-basics`) is not a token.
 *
 * A path is never a problem: the reader has already made it project-relative,
 * or written its home directory as `~`.
 */

/**
 * Token shapes, each with the name a refusal reason gives it. A shape whose
 * secret part is captured is not a token when that part is a kebab-case slug.
 */
const TOKEN_PATTERNS: ReadonlyArray<readonly [string, RegExp]> = [
  ["an API key (sk-…)", /\bsk-([A-Za-z0-9_-]{20,})/g],
  ["a GitHub token", /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_\w{20,})/g],
  ["a Slack token", /\bxox[abprs]-([A-Za-z0-9-]{10,})/g],
  ["an AWS access key", /\bAKIA[0-9A-Z]{16}\b/g],
  ["a Google API key", /\bAIza[0-9A-Za-z_-]{35}/g],
  ["a JWT", /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g],
  ["a private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/g],
  ["a bearer token", /\bBearer\s+([A-Za-z0-9._~+/-]{20,})/g],
  ["a URL with credentials", /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:[^\s/@]+@/gi],
];

/** Lower-case words joined by hyphens: a slug, never a secret. */
const KEBAB_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)+$/;

const holdsToken = (pattern: RegExp, value: string) =>
  [...value.matchAll(pattern)].some(
    (match) => match[1] === undefined || !KEBAB_SLUG.test(match[1])
  );

/** `NAME=value` where the name says it holds a secret, as in a `.env` file. */
const ENV_ASSIGNMENT =
  /^\s*(?:export\s+)?((?=[A-Z])[A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|PWD|CREDENTIALS?|DATABASE_URL|DSN)[A-Z0-9_]*)\s*=\s*["']?[^\s"']{6,}/m;

const isKind = (value: unknown): value is AgentSessionEntryKind =>
  typeof value === "string" &&
  (AGENT_SESSION_ENTRY_KINDS as ReadonlyArray<string>).includes(value);

const textProblems = (where: string, value: string): string[] => {
  const problems: string[] = [];
  for (const [name, pattern] of TOKEN_PATTERNS) {
    if (holdsToken(pattern, value)) problems.push(`${where} holds ${name}`);
  }
  const env = ENV_ASSIGNMENT.exec(value);
  if (env) {
    problems.push(`${where} holds a .env-style value for ${env[1]}`);
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
