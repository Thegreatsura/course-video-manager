import { Effect, Schema, type ParseResult } from "effect";
import type { JobPolicy } from "./retry-policy";

/** What a handler can do besides its work: report what is happening. */
export interface JobContext {
  readonly jobId: string;
  readonly attempt: number;
  readonly maxAttempts: number;
  /** Append a Job Event (`progress`, `stage`, …) the UI will replay. */
  readonly emit: (
    type: string,
    data: Record<string, unknown>
  ) => Effect.Effect<void>;
}

/**
 * One kind of background job: where it runs, how often it may run, what its
 * params look like, and the work. `run` reuses today's services; only the
 * driver moves into the sidecar.
 */
export interface JobKindDefinition<P, I, R> extends JobPolicy {
  readonly params: Schema.Schema<P, I>;
  /** `R`: the services the work needs, which the sidecar's layer provides. */
  readonly run: (params: P, ctx: JobContext) => Effect.Effect<void, unknown, R>;
}

/** A kind with its params type sealed inside, so kinds can share one registry. */
export interface JobKind<R = never> extends JobPolicy {
  readonly decodeParams: (
    raw: unknown
  ) => Effect.Effect<unknown, ParseResult.ParseError>;
  readonly runRaw: (
    raw: unknown,
    ctx: JobContext
  ) => Effect.Effect<void, unknown, R>;
}

export const defineJobKind = <P, I, R = never>(
  definition: JobKindDefinition<P, I, R>
): JobKind<R> => {
  const decode = Schema.decodeUnknown(definition.params);
  return {
    lane: definition.lane,
    maxAttempts: definition.maxAttempts,
    decodeParams: decode,
    runRaw: (raw, ctx) =>
      Effect.flatMap(decode(raw), (params) => definition.run(params, ctx)),
  };
};
