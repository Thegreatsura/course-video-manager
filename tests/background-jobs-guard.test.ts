import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ALLOWLIST_PATH,
  compare,
  scan,
  type Allowlist,
  type Hit,
} from "../scripts/check-background-jobs";

const ROUTE = "apps/local/app/routes/api.videos.$videoId.thing.ts";
const CLIENT = "apps/local/app/features/upload-manager/sse-thing-client.ts";

const guards = (hits: Hit[]) => hits.map((h) => h.guard);

describe("scan", () => {
  it("finds a route streaming a job back, by helper or by hand", () => {
    expect(
      guards(
        scan(
          ROUTE,
          `export const action = () => createSSEResponse(program);
           const h = { "Content-Type": "text/event-stream" };`
        )
      )
    ).toEqual(["sse-route", "sse-route"]);
  });

  it("finds each way a browser keeps a job alive", () => {
    expect(
      guards(
        scan(
          CLIENT,
          `consumeSSEStream({ url });
           const s = new EventSource("/x");
           while (!unmounted) { await poll(); }`
        )
      )
    ).toEqual(["browser-driver", "browser-driver", "browser-driver"]);
  });

  it("finds a process started with @effect/platform's Command, under any name", () => {
    const SERVICE = "apps/local/app/services/thing.ts";
    expect(
      guards(
        scan(
          SERVICE,
          `import { Command, FileSystem } from "@effect/platform";
           const c = Command.make("ffmpeg", "-i", file);`
        )
      )
    ).toEqual(["spawn"]);
    expect(
      guards(
        scan(
          SERVICE,
          `import { Command as Proc } from "@effect/platform";
           Proc.make("ls");`
        )
      )
    ).toEqual(["spawn"]);
    expect(
      guards(
        scan(
          SERVICE,
          `import * as Cmd from "@effect/platform/Command";
           Cmd.make("ls");`
        )
      )
    ).toEqual(["spawn"]);
  });

  it("does not count @effect/cli's Command, which starts no process", () => {
    expect(
      scan(
        "apps/local/app/cli/commands/thing.ts",
        `import { Command } from "@effect/cli";
         export const cmd = Command.make("list", {}, () => run);`
      )
    ).toEqual([]);
  });

  it("ignores comments, tests, the jobs feature and code outside the app", () => {
    const src = `createSSEResponse(p); consumeSSEStream(c); new EventSource("/x");`;
    expect(scan(ROUTE, `// createSSEResponse(program)`)).toEqual([]);
    expect(scan("apps/local/app/routes/x.test.ts", src)).toEqual([]);
    expect(scan("apps/local/app/features/jobs/use-job-events.ts", src)).toEqual(
      []
    );
    expect(scan("apps/local/sidecar/socket.ts", src)).toEqual([]);
  });
});

describe("compare", () => {
  const hit = (guard: Hit["guard"]): Hit => ({ guard, line: 1, text: "" });
  const allowlist: Allowlist = {
    "sse-route": [{ file: ROUTE, count: 1, reason: "moves in batch 2" }],
  };

  it("fails a new background job outside the sidecar", () => {
    const found = new Map([[CLIENT, [hit("browser-driver")]]]);
    expect(compare(found, allowlist, new Set([CLIENT]), false)).toHaveLength(1);
  });

  it("fails an entry once its file has fewer hits, so the list only shrinks", () => {
    const problems = compare(new Map(), allowlist, new Set([ROUTE]), false);
    expect(problems.join()).toMatch(/delete the entry/);
  });

  it("passes when every hit is on the list", () => {
    const found = new Map([[ROUTE, [hit("sse-route")]]]);
    expect(compare(found, allowlist, new Set([ROUTE]), true)).toEqual([]);
  });
});

// ADR 0032 section 7 names every file the guards let start a process, stream
// or loop outside the Sidecar. This holds the ADR to the guards' own lists:
// add a file to either list and the ADR must say why it stays.
describe("ADR 0032 names every allowed entry point", () => {
  const root = path.resolve(import.meta.dirname, "..");
  const adr = readFileSync(
    path.join(root, "docs/adr/0032-background-work-runs-in-the-sidecar.md"),
    "utf8"
  );
  const named = (file: string) => {
    const base = path.basename(file).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`[\`/]${base}\``).test(adr);
  };

  const allowlist = JSON.parse(
    readFileSync(path.join(root, ALLOWLIST_PATH), "utf8")
  ) as Allowlist;
  const allowlisted = Object.values(allowlist).flatMap((entries) =>
    (entries ?? []).map((e) => e.file)
  );

  const spawnConfig = createRequire(import.meta.url)(
    path.join(root, "apps/local/.dependency-cruiser.spawn.cjs")
  ) as {
    forbidden: { name: string; from: { pathNot?: string } }[];
  };
  const childProcessEntryPoints = (
    spawnConfig.forbidden.find(
      (rule) => rule.name === "child-process-outside-interactive-entry-points"
    )?.from.pathNot ?? ""
  )
    .split("|")
    .filter((pattern) => pattern !== "^sidecar/")
    // "^app/routes/api\\.feedback\\.ts$" → "app/routes/api.feedback.ts"
    .map((pattern) => pattern.replace(/^\^|\$$/g, "").replace(/\\/g, ""));

  it("reads both lists", () => {
    expect(allowlisted.length).toBeGreaterThan(0);
    expect(childProcessEntryPoints).toContain("app/routes/api.feedback.ts");
  });

  it.each(allowlisted)("names %s, from the allowlist", (file) => {
    expect(named(file)).toBe(true);
  });

  it.each(childProcessEntryPoints)(
    "names %s, from .dependency-cruiser.spawn.cjs",
    (file) => {
      expect(named(file)).toBe(true);
    }
  );
});
