import { describe, expect, it } from "@effect/vitest";
import { Effect, Exit, TestClock, Fiber } from "effect";
import { UnknownDBServiceError } from "@cvm/core/services/db-service-errors";
import { retryingSettleOps, type SettleOps } from "./settle-retry";

/** Ops whose `returnJobToQueue` fails `failures` times, then lands. */
const flakyOps = (failures: number) => {
  let calls = 0;
  const ops = {
    returnJobToQueue: () =>
      Effect.suspend(() => {
        calls += 1;
        return calls <= failures
          ? Effect.fail(
              new UnknownDBServiceError({
                cause: new Error("getaddrinfo ENOTFOUND db.example"),
              })
            )
          : Effect.succeed(true);
      }),
  } as unknown as SettleOps;
  return { ops, calls: () => calls };
};

const INPUT = { jobId: "j", holder: "h", reason: "the sidecar stopped" };

describe("retryingSettleOps (#2168)", () => {
  it.effect("puts the Job back once the database answers again", () =>
    Effect.gen(function* () {
      const flaky = flakyOps(3);
      const fiber = yield* Effect.fork(
        retryingSettleOps(flaky.ops, 30_000).returnJobToQueue(INPUT)
      );
      yield* TestClock.adjust("10 seconds");
      expect(yield* Fiber.join(fiber)).toBe(true);
      expect(flaky.calls()).toBe(4);
    })
  );

  it.effect("gives up after one Job lease, leaving the Job to recovery", () =>
    Effect.gen(function* () {
      const flaky = flakyOps(1_000);
      const fiber = yield* Effect.fork(
        retryingSettleOps(flaky.ops, 30_000).returnJobToQueue(INPUT)
      );
      yield* TestClock.adjust("2 minutes");
      const exit = yield* Fiber.await(fiber);
      expect(Exit.isFailure(exit)).toBe(true);
      // Backoff capped at 5 s across a 30 s window: a handful of tries.
      expect(flaky.calls()).toBeGreaterThan(3);
      expect(flaky.calls()).toBeLessThan(15);
    })
  );
});
