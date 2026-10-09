// Background work runs in the sidecar, held to a shrink-only allowlist.
//
// A background job — work the author starts and walks away from — that runs as
// one HTTP request, kept alive by a browser tab, dies with that tab, and its
// failure is a toast nobody logged. docs/plans/background-jobs-sidecar.md moves
// every such job into the Sidecar (`apps/local/sidecar/`). These guards
// count the shapes a job takes while it still lives in the request and the
// tab, so none is added while the old ones are moved out:
//
// 1. `sse-route` — a route that streams a long job back: `createSSEResponse(`
//    or a hand-written `text/event-stream` response, in apps/local/app/routes
//    (except `api.jobs.events.ts`, the Job Event subscription).
// 2. `browser-driver` — the browser end that keeps one alive:
//    `consumeSSEStream(`, `new EventSource(` or a `while (!unmounted)` loop,
//    anywhere in apps/local/app outside `features/jobs/` (the Job Event
//    subscription, which only listens and cancels nothing).
// 3. `spawn` — starting a process with `@effect/platform`'s `Command.make(`,
//    anywhere in apps/local/app or the workspace packages (packages/), which
//    run inside the app server too. Each file that may is listed with why: the
//    Sidecar's own spawners (unreachable from routes — the dependency-cruiser
//    half of this guard, `apps/local/.dependency-cruiser.spawn.cjs`, which also
//    holds `child_process` to its interactive entry points), and the app
//    server's interactive calls a person waits on for a moment.
// 4. `network` — an outbound call from server or CLI code: a global `fetch(`
//    (not a path on the app itself, like `fetch("/api/…")`), the AI SDK
//    (`generateText`, `streamText`, `generateObject`, `streamObject`,
//    `new ToolLoopAgent`), `new OpenAI`, `new Anthropic`, or the Cloudinary
//    SDK's `uploader` and `api`. In scope: apps/local/app's services, `.ts`
//    routes, cli and `*.server.ts`, the workspace packages and apps/remote;
//    not apps/local/sidecar. Each file that may is listed with why: quick, the
//    author watches, a live Recording Session, or the posting path. A slow call
//    the author walks away from is a Job. Dependency-cruiser cannot hold this
//    one: every route reaches services/layer.server.ts, which builds the
//    Cloudinary and Buffer clients, so every route "reaches" the network.
//
// Each file is parsed with oxc-parser, so a comment or a string cannot fool
// it. Test code is out of scope. Hits are matched against
// `scripts/background-jobs-allowlist.json`, a count per file with a reason.
// More hits than the entry fails (a new one: enqueue a Job instead); fewer
// fails too (the entry is stale: lower it, or delete it at 0), so the list
// only ever shrinks. The interactive streams — conversations, not background
// work (the plan's question 5) — stay on it by name, with that reason.
//
// Default: staged files (pre-commit). `--all`: every tracked file (CI).

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseSync, type Node } from "oxc-parser";

export type Guard = "sse-route" | "browser-driver" | "spawn" | "network";
export const GUARDS: readonly Guard[] = [
  "sse-route",
  "browser-driver",
  "spawn",
  "network",
];

export interface Hit {
  guard: Guard;
  line: number;
  text: string;
}

export interface AllowlistEntry {
  file: string;
  count: number;
  reason: string;
}
export type Allowlist = Partial<Record<Guard, AllowlistEntry[]>>;

export const ALLOWLIST_PATH = "scripts/background-jobs-allowlist.json";
export const DOC = "docs/plans/background-jobs-sidecar.md";

const isTestFile = (file: string): boolean =>
  /\.(test|spec)\.[cm]?tsx?$/.test(file) ||
  /(^|\/)(tests?|__tests__|test-utils|e2e)\//.test(file) ||
  /-test-(setup|harness)\.tsx?$/.test(file);

// The Job Event subscription itself: it streams what the Sidecar reports, and
// closing it cancels nothing. It is the one stream that stays, by design.
const JOB_EVENTS_ROUTE = "apps/local/app/routes/api.jobs.events.ts";
const inRoutes = (file: string) =>
  file.startsWith("apps/local/app/routes/") && file !== JOB_EVENTS_ROUTE;
const inBrowserScope = (file: string) =>
  file.startsWith("apps/local/app/") &&
  !file.startsWith("apps/local/app/features/jobs/");
const inSpawnScope = (file: string) =>
  file.startsWith("apps/local/app/") || file.startsWith("packages/");

// Server and CLI code. `.tsx` route modules are left out: they hold the
// browser's own calls to the app, and no outbound call today.
const inNetworkScope = (file: string) =>
  /\.ts$/.test(file) &&
  (file.startsWith("apps/local/app/services/") ||
    file.startsWith("apps/local/app/routes/") ||
    file.startsWith("apps/local/app/cli/") ||
    (file.startsWith("apps/local/app/") && file.endsWith(".server.ts")) ||
    file.startsWith("packages/") ||
    file.startsWith("apps/remote/"));

export const isInScope = (file: string): boolean =>
  /\.(ts|tsx)$/.test(file) &&
  !file.endsWith(".d.ts") &&
  !isTestFile(file) &&
  (inRoutes(file) ||
    inBrowserScope(file) ||
    inSpawnScope(file) ||
    inNetworkScope(file));

// ---------------------------------------------------------------------------
// AST helpers

const isNode = (value: unknown): value is Node =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as { type?: unknown }).type === "string";

function walk(node: unknown, visit: (node: Node) => void): void {
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit);
    return;
  }
  if (!isNode(node)) return;
  visit(node);
  for (const [key, value] of Object.entries(node)) {
    if (key === "parent") continue;
    if (value && typeof value === "object") walk(value, visit);
  }
}

/** `name(...)` or `x.name(...)` → "name". */
const calleeName = (node: Node): string | undefined => {
  if (node.type !== "CallExpression" && node.type !== "NewExpression") {
    return undefined;
  }
  const callee = node.callee;
  if (callee.type === "Identifier") return callee.name;
  if (
    callee.type === "MemberExpression" &&
    !callee.computed &&
    callee.property.type === "Identifier"
  ) {
    return callee.property.name;
  }
  return undefined;
};

/** `while (!unmounted)`. */
const isUnmountedLoop = (node: Node): boolean =>
  node.type === "WhileStatement" &&
  node.test.type === "UnaryExpression" &&
  node.test.operator === "!" &&
  node.test.argument.type === "Identifier" &&
  node.test.argument.name === "unmounted";

/** `fetch("/api/…")` or `fetch(`/api/${id}`)`: the app calling itself. */
const isSameOriginFetch = (node: Node): boolean => {
  if (node.type !== "CallExpression") return false;
  const url = node.arguments[0];
  if (!url) return false;
  if (url.type === "Literal" && typeof url.value === "string") {
    return url.value.startsWith("/");
  }
  return (
    url.type === "TemplateLiteral" &&
    (url.quasis[0]?.value.cooked ?? "").startsWith("/")
  );
};

/** `fetch(` or `globalThis.fetch(`. */
const isGlobalFetch = (node: Node): boolean => {
  if (node.type !== "CallExpression") return false;
  const callee = node.callee;
  if (callee.type === "Identifier") return callee.name === "fetch";
  return (
    callee.type === "MemberExpression" &&
    !callee.computed &&
    callee.object.type === "Identifier" &&
    callee.object.name === "globalThis" &&
    callee.property.type === "Identifier" &&
    callee.property.name === "fetch"
  );
};

/** Every name a pattern binds: `{ fetch }`, `[a, ...b]`, `c = 1`. */
function patternNames(pattern: unknown, out: Set<string>): void {
  if (!isNode(pattern)) return;
  if (pattern.type === "Identifier") out.add(pattern.name);
  else if (pattern.type === "ObjectPattern") {
    for (const p of pattern.properties) {
      patternNames(p.type === "RestElement" ? p.argument : p.value, out);
    }
  } else if (pattern.type === "ArrayPattern") {
    for (const e of pattern.elements) patternNames(e, out);
  } else if (pattern.type === "AssignmentPattern") {
    patternNames(pattern.left, out);
  } else if (pattern.type === "RestElement") {
    patternNames(pattern.argument, out);
  }
}

const AI_SDK_CALLS = new Set([
  "generateText",
  "streamText",
  "generateObject",
  "streamObject",
]);
const AI_SDK_AGENTS = new Set(["ToolLoopAgent", "Experimental_Agent"]);

const isEventStreamLiteral = (node: Node): boolean =>
  (node.type === "Literal" && node.value === "text/event-stream") ||
  (node.type === "TemplateLiteral" &&
    node.expressions.length === 0 &&
    node.quasis[0]?.value.cooked === "text/event-stream");

// ---------------------------------------------------------------------------
// Scanning

export function scan(file: string, source: string): Hit[] {
  if (!isInScope(file)) return [];
  if (
    !/createSSEResponse|text\/event-stream|consumeSSEStream|EventSource|unmounted|Command|fetch|"ai"|openai|anthropic-ai|cloudinary/.test(
      source
    )
  ) {
    return [];
  }
  const { program } = parseSync(file, source);

  const lineStarts = [0];
  for (let i = 0; i < source.length; i++) {
    if (source[i] === "\n") lineStarts.push(i + 1);
  }
  const lineOf = (offset: number) => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid]! <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };

  const hits: Hit[] = [];
  const hit = (guard: Guard, node: Node) => {
    const line = lineOf(node.start);
    const text = source
      .slice(lineStarts[line - 1], lineStarts[line] ?? source.length)
      .trim();
    hits.push({ guard, line, text });
  };

  // `Command` as imported from `@effect/platform` (its local name), or the
  // `@effect/platform/Command` module itself: `@effect/cli` has a `Command`
  // too, and building a CLI starts no process.
  const platformCommands = new Set<string>();
  for (const statement of program.body) {
    if (statement.type !== "ImportDeclaration") continue;
    const from = statement.source.value;
    for (const specifier of statement.specifiers) {
      if (
        from === "@effect/platform" &&
        specifier.type === "ImportSpecifier" &&
        specifier.imported.type === "Identifier" &&
        specifier.imported.name === "Command"
      ) {
        platformCommands.add(specifier.local.name);
      }
      if (
        from === "@effect/platform/Command" &&
        specifier.type === "ImportNamespaceSpecifier"
      ) {
        platformCommands.add(specifier.local.name);
      }
    }
  }
  // What the file imports from the AI SDK, OpenAI, Anthropic and Cloudinary,
  // by local name, and whether it binds a `fetch` of its own.
  const aiCalls = new Set<string>();
  const aiAgents = new Set<string>();
  const sdkClients = new Set<string>();
  const cloudinaryNames = new Set<string>();
  const localNames = new Set<string>();
  for (const statement of program.body) {
    if (statement.type !== "ImportDeclaration") continue;
    const from = statement.source.value;
    for (const specifier of statement.specifiers) {
      const local = specifier.local.name;
      localNames.add(local);
      const imported =
        specifier.type === "ImportSpecifier" &&
        specifier.imported.type === "Identifier"
          ? specifier.imported.name
          : undefined;
      if (from === "ai" && imported && AI_SDK_CALLS.has(imported)) {
        aiCalls.add(local);
      }
      if (from === "ai" && imported && AI_SDK_AGENTS.has(imported)) {
        aiAgents.add(local);
      }
      if (
        (from === "openai" || from === "@anthropic-ai/sdk") &&
        (specifier.type === "ImportDefaultSpecifier" ||
          imported === "OpenAI" ||
          imported === "Anthropic")
      ) {
        sdkClients.add(local);
      }
      if (from === "cloudinary") cloudinaryNames.add(local);
    }
  }
  if (inNetworkScope(file) && /fetch/.test(source)) {
    walk(program, (node) => {
      if (node.type === "VariableDeclarator") patternNames(node.id, localNames);
      if (
        node.type === "FunctionDeclaration" ||
        node.type === "FunctionExpression" ||
        node.type === "ArrowFunctionExpression"
      ) {
        if (node.type === "FunctionDeclaration" && node.id) {
          localNames.add(node.id.name);
        }
        for (const param of node.params) patternNames(param, localNames);
      }
    });
  }
  /** `cloudinary.uploader.upload(…)` or `cloudinary.api.resources(…)`. */
  const isCloudinaryCall = (node: Node): boolean => {
    if (node.type !== "CallExpression") return false;
    const callee = node.callee;
    if (callee.type !== "MemberExpression") return false;
    const inner = callee.object;
    return (
      inner.type === "MemberExpression" &&
      !inner.computed &&
      inner.object.type === "Identifier" &&
      cloudinaryNames.has(inner.object.name) &&
      inner.property.type === "Identifier" &&
      (inner.property.name === "uploader" || inner.property.name === "api")
    );
  };
  const isNetworkCall = (node: Node): boolean => {
    if (isGlobalFetch(node)) {
      const bare =
        node.type === "CallExpression" && node.callee.type === "Identifier";
      return !(bare && localNames.has("fetch")) && !isSameOriginFetch(node);
    }
    const callee =
      (node.type === "CallExpression" || node.type === "NewExpression") &&
      node.callee.type === "Identifier"
        ? node.callee.name
        : undefined;
    if (node.type === "CallExpression" && callee && aiCalls.has(callee)) {
      return true;
    }
    if (
      node.type === "NewExpression" &&
      callee &&
      (aiAgents.has(callee) || sdkClients.has(callee))
    ) {
      return true;
    }
    return isCloudinaryCall(node);
  };

  const isPlatformCommandMake = (node: Node): boolean =>
    node.type === "CallExpression" &&
    node.callee.type === "MemberExpression" &&
    !node.callee.computed &&
    node.callee.object.type === "Identifier" &&
    platformCommands.has(node.callee.object.name) &&
    node.callee.property.type === "Identifier" &&
    node.callee.property.name === "make";

  walk(program, (node) => {
    const name = calleeName(node);
    if (inSpawnScope(file) && isPlatformCommandMake(node)) {
      hit("spawn", node);
    }
    if (inNetworkScope(file) && isNetworkCall(node)) hit("network", node);
    if (inRoutes(file)) {
      if (node.type === "CallExpression" && name === "createSSEResponse") {
        hit("sse-route", node);
      }
      if (isEventStreamLiteral(node)) hit("sse-route", node);
    }
    if (inBrowserScope(file)) {
      if (node.type === "CallExpression" && name === "consumeSSEStream") {
        hit("browser-driver", node);
      }
      if (node.type === "NewExpression" && name === "EventSource") {
        hit("browser-driver", node);
      }
      if (isUnmountedLoop(node)) hit("browser-driver", node);
    }
  });

  return hits;
}

// ---------------------------------------------------------------------------
// Comparing against the allowlist

const ADVICE: Record<Guard, string> = {
  "sse-route": `A job the author walks away from is a Job: add a kind under apps/local/sidecar/kinds/ and enqueue it, rather than stream it from a request. See ${DOC}.`,
  "browser-driver": `A browser tab must not keep background work alive: enqueue a Job and follow its Job Events. See ${DOC}.`,
  network: `A slow network or AI call the author walks away from is a Job: enqueue one. A quick call, one the author watches, a live Recording Session's or the posting path's goes on the allowlist with why. See ${DOC}.`,
  spawn: `Starting a process is the Sidecar's job, or one of the app server's named interactive entry points: enqueue a Job, or (if a person waits on it for a moment) add the file to the allowlist with why. See ${DOC}.`,
};

/**
 * Every problem with `found` against `allowlist`. `checked` is the set of
 * files that were scanned: an entry for a file outside it is not judged
 * (staged mode), unless `all` is set.
 */
export function compare(
  found: ReadonlyMap<string, readonly Hit[]>,
  allowlist: Allowlist,
  checked: ReadonlySet<string>,
  all: boolean
): string[] {
  const problems: string[] = [];
  for (const guard of GUARDS) {
    const entries = allowlist[guard] ?? [];
    const allowed = new Map(entries.map((e) => [e.file, e.count]));
    const counts = new Map<string, Hit[]>();
    for (const [file, hits] of found) {
      const mine = hits.filter((h) => h.guard === guard);
      if (mine.length > 0) counts.set(file, mine);
    }

    for (const [file, hits] of counts) {
      const limit = allowed.get(file) ?? 0;
      if (hits.length > limit) {
        problems.push(
          `[${guard}] ${file}: ${hits.length} hit(s), the allowlist allows ${limit}. ${ADVICE[guard]}\n` +
            hits.map((h) => `      ${file}:${h.line}  ${h.text}`).join("\n")
        );
      }
    }

    for (const entry of entries) {
      if (!all && !checked.has(entry.file)) continue;
      const count = counts.get(entry.file)?.length ?? 0;
      if (count < entry.count) {
        problems.push(
          `[${guard}] ${entry.file}: the allowlist says ${entry.count}, found ${count}. ` +
            `The list only shrinks: ${count === 0 ? "delete the entry" : `lower the count to ${count}`} in ${ALLOWLIST_PATH}.`
        );
      }
    }
  }
  return problems;
}

function main() {
  const root = path.resolve(import.meta.dirname, "..");
  const all = process.argv.includes("--all");
  const files = execFileSync(
    "git",
    all ? ["ls-files"] : ["diff", "--cached", "--name-only", "--diff-filter=d"],
    { cwd: root, encoding: "utf8" }
  )
    .split("\n")
    .filter(isInScope);

  const allowlist = JSON.parse(
    readFileSync(path.join(root, ALLOWLIST_PATH), "utf8")
  ) as Allowlist;

  const found = new Map<string, Hit[]>();
  for (const file of files) {
    const abs = path.join(root, file);
    if (!existsSync(abs)) continue;
    const hits = scan(file, readFileSync(abs, "utf8"));
    if (hits.length > 0) found.set(file, hits);
  }

  const problems = compare(found, allowlist, new Set(files), all);
  if (problems.length > 0) {
    console.error("\nERROR: background work outside the sidecar:\n");
    for (const p of problems) console.error(`  ${p}\n`);
    console.error(
      `Background work runs in the sidecar: read ${DOC}. The guard is scripts/check-background-jobs.ts.`
    );
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  main();
}
