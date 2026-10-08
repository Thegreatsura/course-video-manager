import { Data, Effect } from "effect";
import { JobOperationsService } from "@cvm/core/services/db-job-operations.server";
import type { LayerLive } from "@/services/layer.server";
import type { JobKind } from "./job-kind";
import { exportJobKind } from "./kinds/export";
import { noopJobKind } from "./kinds/noop";

/**
 * Every kind of background job the sidecar can run. A new kind is a handler
 * file under `kinds/` and one line here; there is no other way in.
 */
export const JOB_KINDS = {
  noop: noopJobKind,
  export: exportJobKind,
} as const satisfies Record<string, JobKind<JobServices>>;

export type JobKindName = keyof typeof JOB_KINDS;

/**
 * Every service a handler in `JOB_KINDS` may ask for: the app server's own
 * (`layerLive`), which the sidecar builds once for itself.
 */
export type JobServices = LayerLive;

export type JobKindRegistry<R = JobServices> = Readonly<
  Record<string, JobKind<R>>
>;

export class UnknownJobKindError extends Data.TaggedError(
  "UnknownJobKindError"
)<{ readonly kind: string; readonly message: string }> {}

export class NoAttemptsLeftError extends Data.TaggedError(
  "NoAttemptsLeftError"
)<{ readonly kind: string; readonly message: string }> {}

/**
 * The one way to start background work: a row in the job table, with the
 * kind's own lane and attempt count. The params are checked against the
 * kind's schema here, so a bad request fails at the caller, not in the
 * sidecar later.
 */
export const enqueueJob = Effect.fn("enqueueJob")(function* (input: {
  /** The id the caller chose for it (the browser does), or `null` for a fresh one. */
  id: string | null;
  kind: string;
  title: string;
  params: unknown;
  dependsOn: string | null;
  subject: { type: string; id: string } | null;
  /**
   * Attempts this work already spent before it became a Job: a Batch export
   * child the browser retries hands its export to the sidecar with the
   * attempts it had left, so it runs as many times in all as it did when the
   * browser retried it (docs/plans/background-jobs-sidecar.md, section 7.1).
   * 0 for new work.
   */
  attemptsSpent: number;
  /**
   * `JOB_KINDS`, except in a test that brings kinds of its own. Enqueueing
   * never runs a kind, so any kind's requirements will do.
   */
  registry: JobKindRegistry<unknown>;
}) {
  const registry = input.registry;
  const kind = Object.hasOwn(registry, input.kind)
    ? registry[input.kind]
    : undefined;
  if (!kind) {
    return yield* new UnknownJobKindError({
      kind: input.kind,
      message: `no such job kind: ${input.kind}`,
    });
  }
  yield* kind.decodeParams(input.params);
  const maxAttempts = kind.maxAttempts - input.attemptsSpent;
  if (input.attemptsSpent < 0 || maxAttempts < 1) {
    return yield* new NoAttemptsLeftError({
      kind: input.kind,
      message: `a ${input.kind} Job runs at most ${kind.maxAttempts} times; ${input.attemptsSpent} were already spent`,
    });
  }
  const ops = yield* JobOperationsService;
  return yield* ops.enqueueJob({
    id: input.id,
    kind: input.kind,
    title: input.title,
    lane: kind.lane,
    params: input.params ?? {},
    maxAttempts,
    dependsOn: input.dependsOn,
    subject: input.subject,
  });
});
