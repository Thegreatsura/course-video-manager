import type { EffectReducer } from "use-effect-reducer";
import type { jobsReducer } from "./jobs-reducer";

/**
 * Which Jobs are settled, and the author's Dismiss of them: hidden in this
 * tab at once, and recorded on the server (`dismiss-jobs`) so that no later
 * snapshot, in any tab, sends them again. Part of the jobs reducer.
 */

type Exec = Parameters<
  EffectReducer<jobsReducer.State, jobsReducer.Action, jobsReducer.Effect>
>[2];

const FINISHED: readonly jobsReducer.JobStatus[] = [
  "succeeded",
  "failed",
  "interrupted",
];

/** The Job a row belongs to: the row's own id, or a batch row's Job. */
export const jobIdOfRow = (rowId: string) => rowId.split("/")[0] ?? rowId;

export const isFinishedJob = (job: jobsReducer.JobView) =>
  FINISHED.includes(job.status);

/**
 * Record the dismissal of the settled Jobs among `jobs` on the server. A Job
 * the server never heard of (its enqueue failed) has nothing to record.
 */
export const dismissOnServer = (
  exec: Exec,
  jobs: readonly jobsReducer.JobView[]
) => {
  const ids = jobs
    .filter((job) => job.enqueued && isFinishedJob(job))
    .map((job) => job.id);
  if (ids.length > 0) exec({ type: "dismiss-jobs", ids });
};

/** Hide, and record, every Job not hidden yet that `matches`. */
export const dismissSettled = (
  state: jobsReducer.State,
  exec: Exec,
  matches: (job: jobsReducer.JobView) => boolean
): jobsReducer.State => {
  const newly = Object.values(state.jobs).filter(
    (job) => !state.dismissed[job.id] && matches(job)
  );
  if (newly.length === 0) return state;
  dismissOnServer(exec, newly);
  const dismissed = { ...state.dismissed };
  for (const job of newly) dismissed[job.id] = true;
  return { ...state, dismissed };
};

type DismissalAction = Extract<
  jobsReducer.Action,
  {
    type:
      | "press-dismiss"
      | "press-clear-finished"
      | "idle-timeout-elapsed"
      | "dismiss-failed"
      | "job-dismissed";
  }
>;

/** The jobs reducer's dismissal events. */
export const reduceDismissal = (
  state: jobsReducer.State,
  action: DismissalAction,
  exec: Exec
): jobsReducer.State => {
  switch (action.type) {
    case "press-dismiss": {
      // A Job's id, or one of a Batch export's rows (`batchVideoRowId`).
      const job = state.jobs[jobIdOfRow(action.id)];
      if (!job) return state;
      // Only a settled Job's dismissal is kept: one still running is only
      // hidden here, and comes back in a new tab until it settles.
      if (job.id === action.id) dismissOnServer(exec, [job]);
      return { ...state, dismissed: { ...state.dismissed, [action.id]: true } };
    }

    case "press-clear-finished":
      return dismissSettled(state, exec, isFinishedJob);

    case "idle-timeout-elapsed":
      // A failed or interrupted Job needs the author: only they dismiss it.
      return dismissSettled(state, exec, (job) => job.status === "succeeded");

    case "dismiss-failed": {
      // Hidden here, but kept nowhere: it comes back with the next snapshot.
      exec({
        type: "show-dismiss-failed-toast",
        count: action.ids.length,
        message: action.message,
      });
      return state;
    }

    case "job-dismissed":
      if (state.dismissed[action.job.id]) return state;
      return {
        ...state,
        dismissed: { ...state.dismissed, [action.job.id]: true },
      };
  }
};
