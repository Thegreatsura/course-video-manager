import type { EffectReducer } from "use-effect-reducer";
import { isSilentSettlement, succeededToastOf } from "./job-succeeded-toast";
import type { jobsReducer } from "./jobs-reducer";

type Exec = Parameters<
  EffectReducer<jobsReducer.State, jobsReducer.Action, jobsReducer.Effect>
>[2];

/** The toast for a Job that just settled. */
export const announceSettled = (exec: Exec, job: jobsReducer.JobView) => {
  // The author asked for it; the row says what was kept.
  if (job.status === "cancelled") return;
  if (isSilentSettlement(job)) return;
  if (job.status === "succeeded") {
    exec({
      type: "show-job-succeeded-toast",
      jobId: job.id,
      title: job.title,
      toast: succeededToastOf(job),
    });
    return;
  }
  exec({
    type: "show-job-failed-toast",
    jobId: job.id,
    kind: job.kind,
    title: job.title,
    message: job.errorMessage ?? "The job failed",
    hasLog: true,
  });
};

/** Ask for the stage history again: what is in hand may be out of date. */
export const loadStageHistory = (
  state: jobsReducer.State,
  exec: Exec
): jobsReducer.State => {
  const requestId = state.stageHistoryRequest + 1;
  exec({ type: "load-stage-history", requestId });
  return { ...state, stageHistoryRequest: requestId };
};
