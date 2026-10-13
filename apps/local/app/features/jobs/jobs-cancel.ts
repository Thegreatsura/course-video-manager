import type { EffectReducer } from "use-effect-reducer";
import { isCancellableJobKind } from "./job-wire";
import type { jobsReducer } from "./jobs-reducer";

/**
 * The author's Cancel on a Job's row (#2109): only a kind that cleans up
 * after itself offers one (a Storage move). Asked once; the stream brings
 * `cancel-requested`, then `cancelled`. Part of the jobs reducer.
 */

type Exec = Parameters<
  EffectReducer<jobsReducer.State, jobsReducer.Action, jobsReducer.Effect>
>[2];

export const reduceCancel = (
  state: jobsReducer.State,
  action: Extract<
    jobsReducer.Action,
    { type: "press-cancel" } | { type: "cancel-failed" }
  >,
  exec: Exec
): jobsReducer.State => {
  const job = state.jobs[action.id];
  if (!job) return state;
  switch (action.type) {
    case "press-cancel": {
      if (
        !isCancellableJobKind(job.kind) ||
        job.cancelRequested ||
        (job.status !== "queued" &&
          job.status !== "running" &&
          job.status !== "retrying")
      ) {
        return state;
      }
      exec({ type: "cancel-job", id: job.id });
      return {
        ...state,
        jobs: { ...state.jobs, [job.id]: { ...job, cancelRequested: true } },
      };
    }
    case "cancel-failed":
      exec({
        type: "show-cancel-failed-toast",
        title: job.title,
        message: action.message,
      });
      return {
        ...state,
        jobs: { ...state.jobs, [job.id]: { ...job, cancelRequested: false } },
      };
  }
};
