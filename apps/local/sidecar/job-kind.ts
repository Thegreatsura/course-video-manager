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
/** A Job whose run the sidecar lost, as `afterLostRun` is told of it. */
export interface LostJob {
  readonly id: string;
  readonly title: string;
}

export interface JobKindDefinition<P, I, R> extends JobPolicy {
  readonly params: Schema.Schema<P, I>;
  /** `R`: the services the work needs, which the sidecar's layer provides. */
  readonly run: (params: P, ctx: JobContext) => Effect.Effect<void, unknown, R>;
  /**
   * Called once a run of this kind was LOST and settled as a failed attempt —
   * its sidecar died and recovery found the lease expired, or the sidecar lost
   * its lease mid-run — never after a deliberate stop, which puts the Job
   * back. A Batch export hands its unfinished Videos on from here, as the
   * browser did when the stream dropped. Optional; most kinds need nothing.
   */
  readonly afterLostRun?: (job: LostJob) => Effect.Effect<void, unknown, R>;
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
  readonly afterLostRun?: (job: LostJob) => Effect.Effect<void, unknown, R>;
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
    ...(definition.afterLostRun
      ? { afterLostRun: definition.afterLostRun }
      : {}),
  };
};
