import { describe, expect, it } from "@effect/vitest";
import { Deferred, Effect, Fiber, TestClock } from "effect";
import type { SidecarOutcome } from "./sidecar";
import { superviseSidecar } from "./supervise";

/** A sidecar whose runs end as `script` says, one entry per run. */
const scriptedSidecar = (
  script: ReadonlyArray<
    | {
        readonly end: "lapsed" | "failed" | "lease-held";
        readonly afterMs?: number;
      }
    | { readonly end: "stays-up" }
  >
) => {
  const runs: number[] = [];
  const restarts: { delayMs: number; why: string }[] = [];
  const runOnce = (stop: Deferred.Deferred<string>) =>
    Effect.gen(function* () {
      const n = runs.length;
      runs.push(n);
      const step = script[n] ?? { end: "stays-up" as const };
      if (step.end === "stays-up") {
        const reason = yield* Deferred.await(stop);
        return { _tag: "Stopped", reason } as SidecarOutcome;
      }
      yield* Effect.sleep(step.afterMs ?? 0);
      switch (step.end) {
        case "lapsed":
          return { _tag: "Stopped", reason: "lease lapsed" } as SidecarOutcome;
        case "lease-held":
          return { _tag: "LeaseHeld", lease: undefined } as SidecarOutcome;
        case "failed":
          return yield* Effect.fail("ECONNREFUSED 127.0.0.1:5432");
      }
    });
  return { runs, restarts, runOnce };
};

const supervise = (
  sidecar: ReturnType<typeof scriptedSidecar>,
  signalled: Deferred.Deferred<string>
) =>
  superviseSidecar({
    runOnce: sidecar.runOnce,
    signalled,
    initialDelayMs: 1_000,
    maxDelayMs: 30_000,
    healthyAfterMs: 60_000,
    onRestart: (restart) =>
      Effect.sync(() => {
        sidecar.restarts.push(restart);
      }),
  });

describe("the sidecar's supervisor", () => {
  it.effect(
    "runs the sidecar again after a database outage lapses its lease, waiting longer each time it cannot start",
    () =>
      Effect.gen(function* () {
        const sidecar = scriptedSidecar([
          { end: "lapsed" },
          { end: "failed" },
          { end: "failed" },
          { end: "lapsed" },
        ]);
        const signalled = yield* Deferred.make<string>();
        const fiber = yield* Effect.fork(supervise(sidecar, signalled));

        yield* TestClock.adjust(1_000 + 2_000 + 4_000 + 1_000);
        expect(sidecar.runs).toHaveLength(5);
        // A run that held the lease starts the wait over; each run in a row
        // that could not start doubles it.
        expect(sidecar.restarts.map((r) => r.delayMs)).toEqual([
          1_000, 2_000, 4_000, 1_000,
        ]);
        expect(sidecar.restarts[0]?.why).toContain("lease lapsed");
        expect(sidecar.restarts[1]?.why).toContain("ECONNREFUSED");

        yield* Deferred.succeed(signalled, "SIGTERM");
        expect(yield* Fiber.join(fiber)).toEqual({
          _tag: "Signalled",
          signal: "SIGTERM",
        });
      })
  );

  it.effect("never waits more than the cap", () =>
    Effect.gen(function* () {
      const sidecar = scriptedSidecar(
        Array.from({ length: 8 }, () => ({ end: "failed" as const }))
      );
      const signalled = yield* Deferred.make<string>();
      yield* Effect.fork(supervise(sidecar, signalled));
      yield* TestClock.adjust(10 * 60_000);
      expect(sidecar.restarts.map((r) => r.delayMs)).toEqual([
        1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000,
      ]);
    })
  );

  it.effect(
    "waits only a second again after a run that stayed up, however it ended",
    () =>
      Effect.gen(function* () {
        const sidecar = scriptedSidecar([
          { end: "failed" },
          { end: "failed" },
          { end: "failed", afterMs: 2 * 60 * 60_000 },
        ]);
        const signalled = yield* Deferred.make<string>();
        yield* Effect.fork(supervise(sidecar, signalled));
        yield* TestClock.adjust(1_000 + 2_000 + 2 * 60 * 60_000);
        expect(sidecar.restarts.map((r) => r.delayMs)).toEqual([
          1_000, 2_000, 1_000,
        ]);
      })
  );

  it.effect("a signal stops the run and runs it no more, even mid-wait", () =>
    Effect.gen(function* () {
      const sidecar = scriptedSidecar([{ end: "lapsed" }]);
      const signalled = yield* Deferred.make<string>();
      const fiber = yield* Effect.fork(supervise(sidecar, signalled));
      yield* TestClock.adjust(500);
      yield* Deferred.succeed(signalled, "SIGINT");
      expect(yield* Fiber.join(fiber)).toEqual({
        _tag: "Signalled",
        signal: "SIGINT",
      });
      expect(sidecar.runs).toHaveLength(1);
    })
  );

  it.effect("stands down when another sidecar holds the lease", () =>
    Effect.gen(function* () {
      const sidecar = scriptedSidecar([{ end: "lease-held" }]);
      const signalled = yield* Deferred.make<string>();
      const outcome = yield* supervise(sidecar, signalled);
      expect(outcome).toEqual({ _tag: "LeaseHeld", lease: undefined });
      expect(sidecar.restarts).toEqual([]);
    })
  );
});
