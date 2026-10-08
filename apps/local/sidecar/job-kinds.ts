import { Data, Effect } from "effect";
import { JobOperationsService } from "@cvm/core/services/db-job-operations.server";
import type { JobKind } from "./job-kind";
import { noopJobKind } from "./kinds/noop";

/**
 * Every kind of background job the sidecar can run. A new kind is a handler
 * file under `kinds/` and one line here; there is no other way in.
 */
export const JOB_KINDS = {
  noop: noopJobKind,
} as const satisfies Record<string, JobKind>;

export type JobKindName = keyof typeof JOB_KINDS;

export type JobKindRegistry = Readonly<Record<string, JobKind>>;

export class UnknownJobKindError extends Data.TaggedError(
  "UnknownJobKindError"
)<{ readonly kind: string; readonly message: string }> {}

/**
 * The one way to start background work: a row in the job table, with the
 * kind's own lane and attempt count. The params are checked against the
 * kind's schema here, so a bad request fails at the caller, not in the
 * sidecar later.
 */
export const enqueueJob = Effect.fn("enqueueJob")(function* (input: {
  kind: string;
  title: string;
  params: unknown;
  dependsOn: string | null;
  subject: { type: string; id: string } | null;
  /** `JOB_KINDS`, except in a test that brings kinds of its own. */
  registry: JobKindRegistry;
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
  const ops = yield* JobOperationsService;
  return yield* ops.enqueueJob({
    kind: input.kind,
    title: input.title,
    lane: kind.lane,
    params: input.params ?? {},
    maxAttempts: kind.maxAttempts,
    dependsOn: input.dependsOn,
    subject: input.subject,
  });
});
