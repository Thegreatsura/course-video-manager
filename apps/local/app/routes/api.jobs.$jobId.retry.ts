import { Effect, Schema } from "effect";
import { makeAction } from "@/services/route-action.server";
import { nudgeSidecar } from "@/services/sidecar-socket.server";
import { JOB_KIND_SPECS, retryJob } from "../../sidecar/job-specs";

/**
 * The author's **Retry** on a post that failed, or was interrupted ("check
 * before retrying"): the one way a posting Job runs again (decision 5 in
 * docs/plans/background-jobs-sidecar.md). The row goes back to the queue as
 * its next attempt, then the sidecar is nudged. The body names the run the
 * author retried (`attempt`), so a second click or a stale tab cannot run it
 * again.
 */
const RetryJobRequest = Schema.Struct({
  attempt: Schema.Number.pipe(Schema.int(), Schema.positive()),
});

export const action = makeAction({
  input: "json",
  errors: { JobNotFoundError: 404, JobNotRetryableError: 409 },
  effect: ({ params, payload }) =>
    Effect.gen(function* () {
      const request = yield* Schema.decodeUnknown(RetryJobRequest)(payload);
      const job = yield* retryJob({
        jobId: params.jobId ?? "",
        attempt: request.attempt,
        registry: JOB_KIND_SPECS,
      });
      yield* nudgeSidecar();
      return { id: job.id, attempt: job.attempt };
    }),
});
