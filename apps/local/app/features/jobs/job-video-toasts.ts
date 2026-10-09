import type { EffectReducer } from "use-effect-reducer";
import type { jobsReducer } from "./jobs-reducer";

type Exec = Parameters<
  EffectReducer<jobsReducer.State, jobsReducer.Action, jobsReducer.Effect>
>[2];

/**
 * The toast for one Video of a Job that works through several (a Batch
 * export, a Course Autofill) settling, as its browser-driven row toasted:
 *
 * - a Batch export's Video toasts as it lands; its failure is handed on to
 *   its own export Job, which toasts for itself;
 * - an Autofill's Video toasts only when it fails, by name, with the run's
 *   log — the run carries on, and its own toast speaks for the Videos filled;
 * - a Publish's Video toasts only when it fails, as its child row did; the
 *   Publish's own toast speaks for the rest.
 */
export const announceVideoSettled = (
  exec: Exec,
  job: jobsReducer.JobView,
  action: jobsReducer.JobStreamAction,
  /** The Job before this event: a Video already settled is not news again. */
  before: jobsReducer.JobView | undefined
): void => {
  if (action.type === "batch-video-succeeded" && job.kind === "batch-export") {
    const video = job.videos?.find((v) => v.id === action.videoId);
    if (video) {
      exec({
        type: "show-job-succeeded-toast",
        jobId: job.id,
        kind: "export",
        title: video.title,
        subjectId: video.id,
      });
    }
  }
  if (action.type === "batch-video-failed" && job.kind === "publish") {
    const video = job.videos?.find((v) => v.id === action.videoId);
    const was = before?.videos?.find((v) => v.id === action.videoId);
    // Only a Video's first failure: one already settled stays as it was.
    const settledBefore =
      was?.status === "failed" || was?.status === "succeeded";
    if (video?.status === "failed" && !settledBefore) {
      exec({
        type: "show-job-failed-toast",
        jobId: job.id,
        kind: "publish-video",
        title: video.title,
        message: action.message,
        hasLog: true,
      });
    }
  }
  if (action.type === "batch-video-failed" && job.kind === "autofill") {
    const video = job.videos?.find((v) => v.id === action.videoId);
    exec({
      type: "show-job-failed-toast",
      jobId: job.id,
      kind: "autofill-video",
      title: video?.title ?? action.videoId,
      message: action.message,
      hasLog: true,
    });
  }
};
