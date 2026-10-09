import { Effect } from "effect";
import { makeAction } from "@/services/route-action.server";
import { nudgeSidecar } from "@/services/sidecar-socket.server";
import { JOB_KINDS, retryJob } from "../../sidecar/job-kinds";

/**
 * The author's **Retry** on a post that failed, or was interrupted ("check
 * before retrying"): the one way a posting Job runs again (decision 5 in
 * docs/plans/background-jobs-sidecar.md). The row goes back to the queue as
 * its next attempt, then the sidecar is nudged.
 */
export const action = makeAction({
  errors: { JobNotFoundError: 404, JobNotRetryableError: 409 },
  effect: ({ params }) =>
    Effect.gen(function* () {
      const job = yield* retryJob({
        jobId: params.jobId ?? "",
        registry: JOB_KINDS,
      });
      yield* nudgeSidecar();
      return { id: job.id, attempt: job.attempt };
    }),
});
