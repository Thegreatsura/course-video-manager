import { describe, it, expect } from "vitest";
import { Effect, Layer, ManagedRuntime } from "effect";
import { countSqlStatement } from "@cvm/core/db/sql-statement-tally";
import { makeLoader, runRouteEffect } from "./route-action.server";
import {
  logSlowRequest,
  makeSlowRequestMiddleware,
  SLOW_REQUEST_PREFIX,
  tallyStatements,
} from "./slow-request-log.server";

/** What the Drizzle logger does per statement, after `ms` of waiting. */
const statementAfter = (ms: number) =>
  Effect.sleep(ms).pipe(Effect.tap(() => countSqlStatement()));

/** A clock that reads `start`, then `end`. */
const clock = (start: number, end: number) => {
  const reads = [start, end];
  return () => reads.shift() ?? end;
};

describe("logSlowRequest", () => {
  it("logs only the slow request, with its own statement count, while another runs alongside", async () => {
    const runtime = ManagedRuntime.make(Layer.empty);
    const lines: string[] = [];
    const write = (line: string) => lines.push(line);

    // Statements across fibers and across `await`s inside a promise (a
    // transaction's shape), interleaved with a concurrent request's.
    const slow = logSlowRequest(
      new Request("http://localhost/api/courses/c1/duplicate", {
        method: "POST",
      }),
      (tally) =>
        runRouteEffect(
          runtime,
          tallyStatements(
            tally,
            Effect.gen(function* () {
              yield* Effect.all([statementAfter(5), statementAfter(15)], {
                concurrency: "unbounded",
              });
              yield* Effect.promise(async () => {
                await new Promise((r) => setTimeout(r, 10));
                countSqlStatement();
              });
            })
          )
        ),
      { thresholdMs: 2_000, now: clock(0, 2_500), write }
    );
    const fast = logSlowRequest(
      new Request("http://localhost/courses/c1"),
      (tally) =>
        runRouteEffect(runtime, tallyStatements(tally, statementAfter(5))),
      { thresholdMs: 2_000, now: clock(0, 40), write }
    );
    await Promise.all([slow, fast]);
    await runtime.dispose();

    expect(lines).toHaveLength(1);
    expect(lines[0]!.startsWith(`${SLOW_REQUEST_PREFIX} `)).toBe(true);
    expect(JSON.parse(lines[0]!.slice(SLOW_REQUEST_PREFIX.length + 1))).toEqual(
      {
        route: "/api/courses/c1/duplicate",
        method: "POST",
        ms: 2_500,
        dbStatements: 3,
        outcome: "ok",
      }
    );
  });

  it("times every request at the root middleware, counting what its loader's Effect sent", async () => {
    const runtime = ManagedRuntime.make(Layer.empty);
    const lines: string[] = [];
    const middleware = makeSlowRequestMiddleware({
      thresholdMs: 2_000,
      now: clock(0, 2_500),
      write: (line) => lines.push(line),
    });
    const loader = makeLoader(
      { effect: () => Effect.all([statementAfter(5), statementAfter(10)]) },
      runtime as never
    );
    const request = new Request("http://localhost/api/links/fetch-title");
    await middleware({ request, params: {}, context: {} } as never, () =>
      loader({ request, params: {} }).then(() => new Response("ok"))
    );
    await runtime.dispose();

    expect(lines).toHaveLength(1);
    expect(
      JSON.parse(lines[0]!.slice(SLOW_REQUEST_PREFIX.length + 1))
    ).toMatchObject({
      route: "/api/links/fetch-title",
      dbStatements: 2,
      outcome: "ok",
    });
  });
});
