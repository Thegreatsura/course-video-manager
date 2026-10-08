import { Data, Effect, Schema } from "effect";
import { defineJobKind } from "../job-kind";
import { RETRYING_JOB_POLICY } from "../retry-policy";

export class NoopJobFailedError extends Data.TaggedError("NoopJobFailedError")<{
  readonly attempt: number;
  readonly message: string;
}> {}

/**
 * The sidecar's test job: does nothing, slowly if asked, and fails its first
 * attempts if asked. It proves the plumbing — claim, events, logs, retries,
 * recovery — before any real work moves in. It retries like an ordinary
 * Upload Manager job.
 */
export const noopJobKind = defineJobKind({
  ...RETRYING_JOB_POLICY,
  params: Schema.Struct({
    /** How long to take, in steps of up to 100 ms, reporting each. */
    durationMs: Schema.optionalWith(
      Schema.Number.pipe(Schema.int(), Schema.between(0, 600_000)),
      { default: () => 0 }
    ),
    /** Fail every attempt up to and including this one. */
    failAttempts: Schema.optionalWith(
      Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
      { default: () => 0 }
    ),
  }),
  run: (params, ctx) =>
    Effect.gen(function* () {
      yield* Effect.logInfo("noop: started", { durationMs: params.durationMs });
      const steps = Math.max(1, Math.ceil(params.durationMs / 100));
      for (let step = 1; step <= steps; step++) {
        yield* Effect.sleep(params.durationMs / steps);
        yield* ctx.emit("progress", {
          percent: Math.round((step / steps) * 100),
        });
      }
      if (ctx.attempt <= params.failAttempts) {
        return yield* new NoopJobFailedError({
          attempt: ctx.attempt,
          message: `noop: failing attempt ${ctx.attempt} of ${params.failAttempts}, as asked`,
        });
      }
      yield* Effect.logInfo("noop: done");
    }),
});
