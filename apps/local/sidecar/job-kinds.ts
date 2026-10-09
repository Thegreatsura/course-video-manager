import { Data, Effect } from "effect";
import { JobOperationsService } from "@cvm/core/services/db-job-operations.server";
import type { LayerLive } from "@/services/layer.server";
import { isPostingKind, type JobKind } from "./job-kind";
import { autofillJobKind } from "./kinds/autofill";
import { batchExportJobKind } from "./kinds/batch-export";
import { exportJobKind } from "./kinds/export";
import { noopJobKind } from "./kinds/noop";
import { publishJobKind } from "./kinds/publish";
import { renderVerticalJobKind } from "./kinds/render-vertical";
import { aiHeroJobKind } from "./kinds/ai-hero";
import { bufferJobKind } from "./kinds/buffer";
import { skillsChangelogJobKind } from "./kinds/skills-changelog";
import { youtubeJobKind } from "./kinds/youtube";
import { youtubeShortsJobKind } from "./kinds/youtube-shorts";
import type { SidecarContext } from "@/services/sidecar-context";

/**
 * Every kind of background job the sidecar can run. A new kind is a handler
 * file under `kinds/` and one line here; there is no other way in.
 */
export const JOB_KINDS = {
  noop: noopJobKind,
  export: exportJobKind,
  "render-vertical": renderVerticalJobKind,
  "batch-export": batchExportJobKind,
  autofill: autofillJobKind,
  // The `publish` lane, one at a time; never run again on its own.
  publish: publishJobKind,
  // Posting kinds (decision 5): one attempt each, never re-queued.
  youtube: youtubeJobKind,
  "youtube-shorts": youtubeShortsJobKind,
  buffer: bufferJobKind,
  "ai-hero": aiHeroJobKind,
  "skills-changelog": skillsChangelogJobKind,
} as const satisfies Record<string, JobKind<JobServices>>;

export type JobKindName = keyof typeof JOB_KINDS;

/**
 * Every service a handler in `JOB_KINDS` may ask for: the app server's own
 * (`layerLive`), which the sidecar builds once for itself, and the
 * `SidecarContext` only the sidecar provides — the proof work that has moved
 * into a Job asks for, so no route can run it in-process.
 */
export type JobServices = LayerLive | SidecarContext;

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

export class JobNotFoundError extends Data.TaggedError("JobNotFoundError")<{
  readonly jobId: string;
  readonly message: string;
}> {}

export class JobNotRetryableError extends Data.TaggedError(
  "JobNotRetryableError"
)<{ readonly jobId: string; readonly message: string }> {}

/**
 * The author's Retry. Only a POST waits for one (decision 5): every other
 * kind retries on its own while it has attempts, and is not run again by
 * hand. Runs the post once more — the same row, `attempt + 1` — and only if
 * it failed or was interrupted.
 */
export const retryJob = Effect.fn("retryJob")(function* (input: {
  jobId: string;
  registry: JobKindRegistry<unknown>;
}) {
  const ops = yield* JobOperationsService;
  const job = yield* ops.getJob(input.jobId);
  if (!job) {
    return yield* new JobNotFoundError({
      jobId: input.jobId,
      message: `no job ${input.jobId}`,
    });
  }
  const kind = Object.hasOwn(input.registry, job.kind)
    ? input.registry[job.kind]
    : undefined;
  if (!isPostingKind(kind)) {
    return yield* new JobNotRetryableError({
      jobId: job.id,
      message: `a ${job.kind} Job retries on its own; only a post waits for the author's Retry`,
    });
  }
  const retried = yield* ops.retryJob({ jobId: job.id });
  switch (retried.outcome) {
    case "queued":
      return retried.job;
    case "not-found":
      return yield* new JobNotFoundError({
        jobId: job.id,
        message: `no job ${job.id}`,
      });
    case "not-retryable":
      return yield* new JobNotRetryableError({
        jobId: job.id,
        message: `"${job.title}" is ${retried.job.status}: only a failed or interrupted post can be retried`,
      });
    case "dependency-not-succeeded":
      return yield* new JobNotRetryableError({
        jobId: job.id,
        message: `"${job.title}" waits on "${retried.dependency}", which did not succeed: start it again from its page`,
      });
  }
});
