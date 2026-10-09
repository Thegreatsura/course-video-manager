import type { EffectReducer } from "use-effect-reducer";
import type { jobsReducer } from "./jobs-reducer";

/**
 * What became of this tab's request to enqueue a Job: answered yes, answered
 * no, or never answered. Part of the jobs reducer.
 */

type Exec = Parameters<
  EffectReducer<jobsReducer.State, jobsReducer.Action, jobsReducer.Effect>
>[2];

type EnqueueOutcome = Extract<
  jobsReducer.Action,
  { type: "enqueue-succeeded" | "enqueue-failed" | "enqueue-unanswered" }
>;

/**
 * What a row says while an enqueue goes unanswered: it may be queued already,
 * so it must not look failed — that would invite posting it a second time.
 */
export const ENQUEUE_UNCONFIRMED_MESSAGE =
  "Not confirmed yet — checking whether it was queued";

/** How long before asking again, after `checks` unanswered asks. */
const enqueueCheckDelayMs = (checks: number) =>
  Math.min(1_000 * 2 ** (checks - 1), 30_000);

/**
 * The Job is on the server. The row stays `requested` until the stream says
 * `queued`: the stream is the only word on a Job's state. What waited on it
 * may go now.
 */
const enqueued = (
  state: jobsReducer.State,
  id: string,
  exec: Exec
): jobsReducer.State => {
  const job = state.jobs[id];
  if (!job) return state;
  const { [id]: waiting = [], ...held } = state.held;
  for (const enqueue of waiting) exec(enqueue);
  return {
    ...state,
    held,
    jobs: { ...state.jobs, [job.id]: { ...job, enqueued: true } },
  };
};

/** An enqueue that failed: it, and every Job held on it, fails here. */
const failRequested = (
  state: jobsReducer.State,
  id: string,
  message: string,
  exec: Exec
): jobsReducer.State => {
  const job = state.jobs[id];
  if (!job || job.status !== "requested") return state;
  const failed: jobsReducer.JobView = {
    ...job,
    status: "failed",
    errorMessage: message,
  };
  exec({
    type: "show-job-failed-toast",
    jobId: job.id,
    kind: job.kind,
    title: job.title,
    message,
    hasLog: false,
  });
  exec({
    type: "report-job-settled",
    jobId: job.id,
    title: job.title,
    outcome: "failed",
  });
  const { [id]: waiting = [], ...held } = state.held;
  let next: jobsReducer.State = {
    ...state,
    held,
    jobs: { ...state.jobs, [job.id]: failed },
  };
  for (const child of waiting) {
    next = failRequested(
      next,
      child.id,
      `Dependency "${job.title}" failed`,
      exec
    );
  }
  return next;
};

export const reduceEnqueueOutcome = (
  state: jobsReducer.State,
  action: EnqueueOutcome,
  exec: Exec
): jobsReducer.State => {
  switch (action.type) {
    case "enqueue-succeeded":
      return enqueued(state, action.id, exec);
    case "enqueue-failed":
      return failRequested(state, action.id, action.message, exec);
    case "enqueue-unanswered": {
      const job = state.jobs[action.enqueue.id];
      if (!job) return state;
      // The stream has already shown the Job: it was queued after all.
      if (job.status !== "requested") return enqueued(state, job.id, exec);
      // Enqueueing is idempotent on the id, so asking again is safe: it adds
      // the Job if the first ask never landed, and answers if it did.
      const checks = action.enqueue.checks + 1;
      exec({
        ...action.enqueue,
        checks,
        afterMs: enqueueCheckDelayMs(checks),
      });
      return {
        ...state,
        jobs: {
          ...state.jobs,
          [job.id]: { ...job, errorMessage: ENQUEUE_UNCONFIRMED_MESSAGE },
        },
      };
    }
  }
};
