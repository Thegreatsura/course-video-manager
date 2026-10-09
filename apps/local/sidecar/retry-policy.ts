import type { LaneName } from "./lanes";

/**
 * How many times each kind of job runs before it fails, and which lane it
 * runs in — COPIED from the Upload Manager, per Matt's decision
 * (docs/plans/background-jobs-sidecar.md, section 6). The sidecar adds no
 * policy of its own.
 *
 * Today, in the browser:
 *
 * - A job's failure (`UPLOAD_ERROR`) counts an attempt; while fewer than 3
 *   have run and the entry is not `terminal`, it goes to `retrying`
 *   (`features/upload-manager/upload-reducer.ts:567`), and
 *   `planUploadReactions` re-runs it AT ONCE with the params it started with
 *   (`upload-transitions.ts:51`, `upload-context.tsx:620`). No delay, no
 *   backoff, and every error is retryable. So: 3 attempts.
 * - A Publish and an Autofill report every failure as `UPLOAD_FATAL_ERROR`
 *   (`upload-type-registry.ts:577-634`, `upload-type-autofill.ts:88-108`),
 *   which sets `terminal` (`upload-reducer.ts:533`) — and so do the per-Video
 *   rows each fans out into. So: 1 attempt.
 * - EXCEPT posting (YouTube, Shorts, Buffer, AI Hero, Skills Changelog):
 *   Matt's decision 5 gives each exactly 1 attempt and no re-queue — see
 *   `PostingJobPolicy` below.
 * - A dropped stream is a failure like any other: the reader rejects, the
 *   client calls `onError`, and the job spends an attempt. The sidecar treats
 *   a run it lost — its lease ran out, or it was stopped — the same way
 *   (`recoverExpiredJobs` / an interrupted fiber), so a cut-off attempt is
 *   retried while attempts remain and is `interrupted` on the last.
 * - When a job fails for good, every job waiting on it fails with
 *   `Dependency "<title>" failed` (`upload-reducer.ts:554` and `:597`). The
 *   sidecar does the same, in the same transaction.
 *
 * The narrow retries INSIDE a service stay inside it, untouched: an export
 * inside a Publish or batch `recurs(2)` (`course-publish-export-events.ts:160`),
 * the Dropbox commit `recurs(1)` (`course-publish-service.ts:413`), Dropbox HTTP
 * `recurs(5)` on a 429/5xx (`dropbox-http-client.ts:36-39`), an AI Hero part 5
 * (`ai-hero-upload-service.ts:12`), Autofill's `recurs(3)` per Video
 * (`autofill-service.ts:57-62`).
 */
/**
 * A kind that retries: copied from the Upload Manager, attempts as listed.
 */
export interface RetryingJobPolicy {
  readonly lane: LaneName;
  readonly maxAttempts: number;
  readonly posting?: false;
}

/**
 * A kind that POSTS to an outside service (YouTube, Buffer, AI Hero). Matt's
 * decision 5 (docs/plans/background-jobs-sidecar.md, section 6): "Posting
 * twice would be disastrous." So a posting kind runs EXACTLY ONCE:
 *
 * - `maxAttempts` is the literal `1`: no automatic retry when it fails;
 * - `posting: true` makes the sidecar end a run cut off by a deliberate stop
 *   as `interrupted` instead of putting it back in the queue (section 7.5's
 *   rule does not apply), and makes recovery after a crash end it the same
 *   way whatever its attempt counts say;
 * - only the author's Retry runs it again (`retryJob`).
 *
 * The browser used to retry a failed post up to 3 times; that is removed on
 * purpose. `posting-kinds.test.ts` fails if any posting kind slips back.
 */
export interface PostingJobPolicy {
  readonly lane: LaneName;
  readonly maxAttempts: 1;
  readonly posting: true;
}

export type JobPolicy = RetryingJobPolicy | PostingJobPolicy;

/** The one policy every posting kind has. */
export const POSTING_JOB_POLICY = {
  lane: "default",
  maxAttempts: 1,
  posting: true,
} as const satisfies PostingJobPolicy;

/**
 * Every Upload Manager job type, and the policy it brings with it to the
 * sidecar. The five posting types are the exception decision 5 makes: the
 * browser gave each of them 3 attempts (`UPLOAD_ERROR`,
 * `upload-type-registry.ts`); the sidecar gives each exactly 1.
 */
export const UPLOAD_MANAGER_POLICIES = {
  export: { lane: "default", maxAttempts: 3 },
  youtube: POSTING_JOB_POLICY,
  "youtube-shorts": POSTING_JOB_POLICY,
  buffer: POSTING_JOB_POLICY,
  "ai-hero": POSTING_JOB_POLICY,
  "skills-changelog": POSTING_JOB_POLICY,
  "render-vertical": { lane: "default", maxAttempts: 3 },
  /**
   * A Batch export has no row and no retry of its own in the browser: it is
   * one stream, and its retries are per Video — `recurs(2)` inside the
   * service (`course-publish-export-events.ts:160`), then the browser's
   * standalone export with the attempts the row had left
   * (`upload-context.tsx`, the `initiate: null` hand-off). So: 1 attempt for
   * the batch; its Videos carry the retries (`kinds/batch-export.ts`).
   */
  "batch-export": { lane: "default", maxAttempts: 1 },
  publish: { lane: "publish", maxAttempts: 1 },
  autofill: { lane: "default", maxAttempts: 1 },
} as const satisfies Record<string, JobPolicy>;

/**
 * The Upload Manager types that post to an outside service: each must be a
 * posting kind in the sidecar's registry (`posting-kinds.test.ts`).
 */
export const POSTING_KIND_NAMES = [
  "youtube",
  "youtube-shorts",
  "buffer",
  "ai-hero",
  "skills-changelog",
] as const;

/** The policy of an ordinary, retrying Upload Manager job. */
export const RETRYING_JOB_POLICY: RetryingJobPolicy =
  UPLOAD_MANAGER_POLICIES.export;
