import { Effect, Schema, type ParseResult } from "effect";
import {
  INTERRUPTED_POST_MESSAGE,
  type JobFailure,
} from "@cvm/core/services/db-job-operations.server";
import {
  POSTING_JOB_POLICY,
  type JobPolicy,
  type RetryingJobPolicy,
} from "./retry-policy";

/** Another Job a handler starts, as it asks for one. */
export interface JobRequest {
  readonly kind: string;
  readonly title: string;
  readonly params: unknown;
  readonly subject: { readonly type: string; readonly id: string } | null;
  /** Attempts the work already spent before it became this Job (0 for new work). */
  readonly attemptsSpent: number;
  readonly dependsOn: string | null;
}

/**
 * Start another Job through the one path every Job takes (`enqueueJob`):
 * the kind's own lane and attempts, its params checked, and a dependency
 * that already failed failing it at once. Never a write to the job table.
 */
export type EnqueueJob = (
  request: JobRequest
) => Effect.Effect<{ readonly id: string }, unknown>;

/** What a handler can do besides its work: report, and start other Jobs. */
export interface JobContext {
  readonly jobId: string;
  readonly attempt: number;
  readonly maxAttempts: number;
  /** Append a Job Event (`progress`, `stage`, …) the UI will replay. */
  readonly emit: (
    type: string,
    data: Record<string, unknown>
  ) => Effect.Effect<void>;
  readonly enqueue: EnqueueJob;
}

/** A Job whose run the sidecar lost, as `afterLostRun` is told of it. */
export interface LostJob {
  readonly id: string;
  readonly title: string;
}

/** What `afterLostRun` can do: start other Jobs. */
export interface LostRunContext {
  readonly enqueue: EnqueueJob;
}

/** A post that was cut off, as `checkPosted` is told of it. */
export interface InterruptedPost {
  readonly id: string;
  readonly title: string;
  /** When its last run started: a post that went out went out after this. */
  readonly startedAt: Date | null;
}

/**
 * What the sidecar found when it looked for an interrupted post at the
 * service: it went out, it did not, or there was no way to tell. Written as a
 * `post-check` Job Event, and shown on the post's row.
 */
export interface PostCheck {
  readonly verdict: "posted" | "not-posted" | "unknown";
  /** One sentence, for the row. */
  readonly detail: string;
  /** Where to look at it, when it was found. */
  readonly url: string | null;
}

/**
 * One kind of background job: where it runs, how often it may run, what its
 * params look like, and the work. `run` reuses today's services; only the
 * driver moves into the sidecar.
 */
export type RetryingJobKindDefinition<P, I, R> = RetryingJobPolicy & {
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
  readonly afterLostRun?: (
    job: LostJob,
    ctx: LostRunContext
  ) => Effect.Effect<void, unknown, R>;
};

/**
 * A kind that posts to an outside service. Its policy is fixed
 * (`POSTING_JOB_POLICY`: 1 attempt, never re-queued), so a definition cannot
 * name one; it must say how to find out whether a cut-off post went out.
 */
export interface PostingJobKindDefinition<P, I, R> {
  readonly params: Schema.Schema<P, I>;
  readonly run: (params: P, ctx: JobContext) => Effect.Effect<void, unknown, R>;
  /**
   * Look for the post at the service, read-only, after a run of it was cut
   * off. Never posts. A kind whose service cannot be asked answers `unknown`
   * and says so.
   */
  readonly checkPosted: (
    params: P,
    post: InterruptedPost
  ) => Effect.Effect<PostCheck, unknown, R>;
}

/** A kind with its params type sealed inside, so kinds can share one registry. */
interface JobKindBase<R> {
  readonly decodeParams: (
    raw: unknown
  ) => Effect.Effect<unknown, ParseResult.ParseError>;
  readonly runRaw: (
    raw: unknown,
    ctx: JobContext
  ) => Effect.Effect<void, unknown, R>;
}

export type RetryingJobKind<R = never> = RetryingJobPolicy &
  JobKindBase<R> & {
    readonly afterLostRun?: (
      job: LostJob,
      ctx: LostRunContext
    ) => Effect.Effect<void, unknown, R>;
  };

export interface PostingJobKind<R = never> extends JobKindBase<R> {
  readonly lane: typeof POSTING_JOB_POLICY.lane;
  readonly maxAttempts: 1;
  readonly posting: true;
  readonly checkPostedRaw: (
    raw: unknown,
    post: InterruptedPost
  ) => Effect.Effect<PostCheck, unknown, R>;
}

export type JobKind<R = never> = RetryingJobKind<R> | PostingJobKind<R>;

/**
 * Whether a kind is never run again on its own, by anything — not put back by
 * a deliberate stop (section 7.5), not retried by recovery after a crash, not
 * retried after a lost lease. A post (decision 5) and a kind marked
 * `neverRequeued` (a Publish, section 7.2): those end `interrupted` and wait
 * for a person.
 */
export const isNeverReRun = (
  kind:
    { readonly posting?: boolean; readonly neverRequeued?: boolean } | undefined
): boolean => kind?.posting === true || kind?.neverRequeued === true;

type NeverReRunFields = {
  readonly posting?: boolean;
  readonly neverRequeued?: boolean;
  readonly interruptedMessage?: string;
};

/**
 * What a kind that is never run again on its own says once it ends
 * `interrupted`, in its own words: a post may have gone out; a Publish may
 * have left a Pending Version to Promote or Discard. `null` for every other
 * kind.
 */
export const neverReRunMessageOf = (
  kind: NeverReRunFields | undefined
): string | null => {
  if (kind?.posting === true) return INTERRUPTED_POST_MESSAGE;
  // The type requires a message; a missing one must still never re-run it.
  if (kind?.neverRequeued === true) {
    return (
      kind.interruptedMessage ?? "Interrupted, and never re-run on its own"
    );
  }
  return null;
};

const INTERRUPTED: JobFailure = {
  tag: "JobInterrupted",
  message: "The sidecar stopped while this job was running",
  cause: "interrupted: the sidecar was stopped, or lost the job's lease",
};

/**
 * How a run cut off by a stop or a lost lease ends. A kind that is never
 * re-run on its own (a post, decision 5; a Publish, section 7.2) says so in
 * its own words.
 */
export const interruptedFailureOf = (
  kind: NeverReRunFields | undefined
): JobFailure => {
  const message = neverReRunMessageOf(kind);
  return message === null
    ? INTERRUPTED
    : {
        ...INTERRUPTED,
        message,
        cause:
          "interrupted: the sidecar was stopped, or lost the job's lease, and this kind is never re-run on its own",
      };
};

/**
 * The kinds in `registry` that are never run again on its own, each with its
 * never-re-run message: what recovery after a crash writes on the row.
 */
export const neverReRunMessagesOf = (
  registry: Readonly<Record<string, NeverReRunFields>>
): Record<string, string> => {
  const messages: Record<string, string> = {};
  for (const name of Object.keys(registry)) {
    const message = neverReRunMessageOf(registry[name]);
    if (message !== null) messages[name] = message;
  }
  return messages;
};

/** Whether a kind posts: 1 attempt, never re-queued, Retry by hand only. */
export const isPostingKind = (
  kind: { readonly posting?: boolean } | JobPolicy | undefined
): boolean => kind?.posting === true;

export const defineJobKind = <P, I, R = never>(
  definition: RetryingJobKindDefinition<P, I, R>
): RetryingJobKind<R> => {
  const decode = Schema.decodeUnknown(definition.params);
  return {
    lane: definition.lane,
    ...(definition.neverRequeued
      ? {
          maxAttempts: 1 as const,
          neverRequeued: true as const,
          interruptedMessage: definition.interruptedMessage,
        }
      : { maxAttempts: definition.maxAttempts }),
    decodeParams: decode,
    runRaw: (raw, ctx) =>
      Effect.flatMap(decode(raw), (params) => definition.run(params, ctx)),
    ...(definition.afterLostRun
      ? { afterLostRun: definition.afterLostRun }
      : {}),
  };
};

/**
 * Define a kind that posts to an outside service. It gets
 * `POSTING_JOB_POLICY` and nothing else: there is no way to give it a second
 * attempt from here.
 */
export const definePostingJobKind = <P, I, R = never>(
  definition: PostingJobKindDefinition<P, I, R>
): PostingJobKind<R> => {
  const decode = Schema.decodeUnknown(definition.params);
  return {
    ...POSTING_JOB_POLICY,
    decodeParams: decode,
    runRaw: (raw, ctx) =>
      Effect.flatMap(decode(raw), (params) => definition.run(params, ctx)),
    checkPostedRaw: (raw, post) =>
      Effect.flatMap(decode(raw), (params) =>
        definition.checkPosted(params, post)
      ),
  };
};
