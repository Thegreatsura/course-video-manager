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
export interface JobPolicy {
  readonly lane: LaneName;
  readonly maxAttempts: number;
}

/** Every Upload Manager job type, and the policy it brings with it to the sidecar. */
export const UPLOAD_MANAGER_POLICIES = {
  export: { lane: "default", maxAttempts: 3 },
  youtube: { lane: "default", maxAttempts: 3 },
  "youtube-shorts": { lane: "default", maxAttempts: 3 },
  buffer: { lane: "default", maxAttempts: 3 },
  "ai-hero": { lane: "default", maxAttempts: 3 },
  "skills-changelog": { lane: "default", maxAttempts: 3 },
  "render-vertical": { lane: "default", maxAttempts: 3 },
  publish: { lane: "publish", maxAttempts: 1 },
  autofill: { lane: "default", maxAttempts: 1 },
} as const satisfies Record<string, JobPolicy>;

/** The policy of an ordinary, retrying Upload Manager job. */
export const RETRYING_JOB_POLICY: JobPolicy = UPLOAD_MANAGER_POLICIES.export;
