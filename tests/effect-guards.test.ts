import { describe, expect, it } from "vitest";
import {
  compare,
  scan,
  type Allowlist,
  type Hit,
} from "../scripts/check-effect-guards";

const PRODUCT = "apps/local/app/services/some-service.ts";

const guardsIn = (source: string, file = PRODUCT) =>
  scan(file, source).map((h) => h.guard);

describe("scan: effect-run", () => {
  it("flags Effect.run* calls and runtime.run* calls", () => {
    expect(
      guardsIn(`
        Effect.runPromise(eff);
        runtimeLive.runPromiseExit(eff);
        Effect.runSync(eff);
      `)
    ).toEqual(["effect-run", "effect-run", "effect-run"]);
  });

  it("flags a point-free run passed to pipe", () => {
    expect(guardsIn(`eff.pipe(runtimeLive.runPromise);`)).toEqual([
      "effect-run",
    ]);
  });

  it("ignores boundary files, test files and comments", () => {
    const src = `Effect.runPromise(eff); // Effect.runSync(x)`;
    expect(
      guardsIn(src, "apps/local/app/services/route-action.server.ts")
    ).toEqual([]);
    expect(guardsIn(src, "apps/local/app/cli/commands/foo.ts")).toEqual([]);
    expect(guardsIn(src, "apps/local/app/services/foo.test.ts")).toEqual([]);
    expect(
      guardsIn(`// Effect.runSync(x)\n/* Effect.runPromise(y) */`)
    ).toEqual([]);
  });
});

describe("scan: swallowed-catch", () => {
  it("flags handlers that drop the error, across line breaks", () => {
    expect(
      guardsIn(`
        a.pipe(Effect.catchAll(() => Effect.void));
        b.pipe(Effect.catchAll(() => Effect.succeed(null)));
        c.pipe(Effect.catchAllCause((_cause) => Effect.void));
        d.pipe(
          Effect.catchAll(() => {
            return Effect.succeed(
              []
            );
          })
        );
        Effect.catchAll(e, () => Effect.succeed(null as string | null));
      `)
    ).toEqual(Array(5).fill("swallowed-catch"));
  });

  it("allows handlers that use the error, log it, or are explicit about defects", () => {
    expect(
      guardsIn(`
        a.pipe(Effect.catchAll((e) => Effect.succeed({ message: e.message })));
        b.pipe(Effect.catchAll((e) => Effect.logWarning(e)));
        c.pipe(Effect.catchAll(() => Effect.fail(new Other())));
        d.pipe(Effect.catchAllDefect(() => Effect.void));
        e.pipe(Effect.catchTag("NotFoundError", () => Effect.succeed(null)));
      `)
    ).toEqual([]);
  });
});

describe("scan: effect-promise", () => {
  it("flags Effect.promise in product code only", () => {
    const src = `Effect.promise(() => db.select()); Effect.tryPromise(() => x);`;
    expect(guardsIn(src)).toEqual(["effect-promise"]);
    expect(guardsIn(src, "packages/core/services/x.test.ts")).toEqual([]);
    expect(guardsIn(src, "apps/local/app/test-utils/fake.ts")).toEqual([]);
  });
});

describe("compare", () => {
  const hit = (guard: Hit["guard"]): Hit => ({ guard, line: 1, text: "" });
  const found = new Map([
    [PRODUCT, [hit("effect-promise"), hit("effect-promise")]],
  ]);
  const allow = (count: number): Allowlist => ({
    "effect-promise": [{ file: PRODUCT, count, reason: "r" }],
  });

  it("passes when the count matches the allowlist exactly", () => {
    expect(compare(found, allow(2), new Set([PRODUCT]), true)).toEqual([]);
  });

  it("fails on a new hit", () => {
    expect(compare(found, allow(1), new Set([PRODUCT]), true)).toHaveLength(1);
    expect(compare(found, {}, new Set([PRODUCT]), true)).toHaveLength(1);
  });

  it("fails on a stale entry, so the list only shrinks", () => {
    const [problem] = compare(found, allow(3), new Set([PRODUCT]), true);
    expect(problem).toMatch(/lower the count to 2/);
    const [gone] = compare(new Map(), allow(2), new Set(), true);
    expect(gone).toMatch(/delete the entry/);
  });

  it("only judges entries for checked files in staged mode", () => {
    expect(compare(new Map(), allow(2), new Set(), false)).toEqual([]);
  });
});
