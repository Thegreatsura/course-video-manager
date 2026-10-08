import { describe, expect, it } from "vitest";
import {
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
