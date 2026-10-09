import { Cause, Data, Effect } from "effect";
import {
  JobOperationsService,
  POST_CHECK_EVENT,
  type Job,
} from "@cvm/core/services/db-job-operations.server";
import { isPostingKind, type PostCheck } from "./job-kind";
import type { JobKindRegistry } from "./job-kinds";

export { POST_CHECK_EVENT };

/** The service did not answer a post-check in time. */
export class PostCheckTimeoutError extends Data.TaggedError(
  "PostCheckTimeoutError"
)<{ readonly message: string }> {}

/** An interrupted post older than this is not looked for any more. */
const POST_CHECK_WITHIN_MS = 24 * 60 * 60_000;

/** The kinds in `registry` that post (decision 5). */
export const postingKindsOf = <R>(registry: JobKindRegistry<R>) =>
  Object.keys(registry).filter((name) => isPostingKind(registry[name]));

const messageOf = (cause: Cause.Cause<unknown>) => {
  const error = Cause.squash(cause);
  return error instanceof Error ? error.message : String(error);
};

/**
 * "Interrupted — check before retrying": look, read-only, for every
 * interrupted post not yet looked for, and write what was found as a
 * `post-check` Job Event for its row. One sweep at a time; a look that fails
 * or hangs says `unknown`. A post a deliberate stop cut off is looked for by
 * the next sidecar, after its recovery.
 */
export const makePostChecks = <R>(opts: {
  readonly registry: JobKindRegistry<R>;
  readonly timeoutMs: number;
  /** Tell subscribers there is a new Job Event. */
  readonly wake: Effect.Effect<void>;
}) =>
  Effect.gen(function* () {
    const ops = yield* JobOperationsService;
    const lock = yield* Effect.makeSemaphore(1);
    const kinds = postingKindsOf(opts.registry);

    const checkOne = (job: Job) => {
      const kind = Object.hasOwn(opts.registry, job.kind)
        ? opts.registry[job.kind]
        : undefined;
      if (!kind || !("checkPostedRaw" in kind)) return Effect.void;
      return kind
        .checkPostedRaw(job.params, {
          id: job.id,
          title: job.title,
          startedAt: job.startedAt,
        })
        .pipe(
          Effect.timeoutFail({
            duration: opts.timeoutMs,
            onTimeout: () =>
              new PostCheckTimeoutError({
                message: `no answer in ${Math.round(opts.timeoutMs / 1000)}s`,
              }),
          }),
          Effect.catchAllCause((cause) =>
            Effect.logWarning("post-check: could not look", cause).pipe(
              Effect.as<PostCheck>({
                verdict: "unknown",
                detail: `Could not check: ${messageOf(cause)}`,
                url: null,
              })
            )
          ),
          Effect.tap((check) =>
            Effect.logInfo(`post-check: ${check.verdict}`, check)
          ),
          Effect.flatMap((check) =>
            ops.appendJobEvent({
              jobId: job.id,
              type: POST_CHECK_EVENT,
              // The run it looked at: a Retry may have started the next one.
              data: { ...check, attempt: job.attempt },
            })
          ),
          Effect.zipRight(opts.wake),
          Effect.annotateLogs({ jobId: job.id, kind: job.kind }),
          Effect.catchAllCause((cause) =>
            Effect.logError("post-check: could not record what it found", cause)
          )
        );
    };

    const sweep: Effect.Effect<void, never, R> = lock.withPermits(1)(
      ops
        .listInterruptedJobsWithoutEvent({
          kinds,
          eventType: POST_CHECK_EVENT,
          finishedWithinMs: POST_CHECK_WITHIN_MS,
        })
        .pipe(
          Effect.flatMap((posts) =>
            Effect.forEach(posts, checkOne, { discard: true })
          ),
          Effect.catchAllCause((cause) =>
            Effect.logError("sidecar: the post-check sweep failed", cause)
          )
        )
    );
    return { kinds, sweep };
  });
