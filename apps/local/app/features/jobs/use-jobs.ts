import { useCallback, useEffect, useRef } from "react";
import { useEffectReducer } from "use-effect-reducer";
import {
  createInitialJobsState,
  jobsReducer,
  toJobsAction,
} from "./jobs-reducer";
import {
  decodeStreamData,
  JOB_STREAM_EVENTS,
  JobEventMessage,
  JobSnapshotMessage,
  SidecarUnavailableMessage,
} from "./job-wire";
import {
  showJobFailedToast,
  showJobSucceededToast,
  showSidecarNotRunningToast,
} from "./job-toasts";

type Dispatch = (action: jobsReducer.Action) => void;

export type JobSettledReport = Extract<
  jobsReducer.Effect,
  { type: "report-job-settled" }
>;

export interface StartJobRequest {
  kind: string;
  title: string;
  params: Record<string, unknown>;
  subject: { type: string; id: string } | null;
  /** Attempts already spent before this became a Job (0 for new work). */
  attemptsSpent: number;
}

/**
 * The bridge to the Sidecar's Job Event stream: one EventSource per tab,
 * which only dispatches what it hears. Closing it cancels nothing.
 */
function useJobEventStream(dispatch: Dispatch) {
  useEffect(() => {
    const source = new EventSource("/api/jobs/events");
    source.addEventListener(JOB_STREAM_EVENTS.snapshot, (event) => {
      const snapshot = decodeStreamData(JobSnapshotMessage, event.data);
      if (snapshot) dispatch({ type: "job-snapshot-received", snapshot });
    });
    source.addEventListener(JOB_STREAM_EVENTS.jobEvent, (event) => {
      const message = decodeStreamData(JobEventMessage, event.data);
      const action = message ? toJobsAction(message) : null;
      if (action) dispatch(action);
    });
    source.addEventListener(JOB_STREAM_EVENTS.sidecarUnavailable, (event) => {
      const unavailable = decodeStreamData(
        SidecarUnavailableMessage,
        event.data
      );
      if (unavailable) {
        dispatch({ type: "sidecar-unavailable", message: unavailable.message });
      }
    });
    return () => source.close();
  }, [dispatch]);
}

/**
 * This tab's view of the background Jobs, and the one way it starts one.
 * `onJobSettled` hears every Job that settles, so the Upload Manager can start
 * (or fail) the uploads waiting on it.
 */
export function useJobs(onJobSettled: (report: JobSettledReport) => void) {
  const onJobSettledRef = useRef(onJobSettled);
  onJobSettledRef.current = onJobSettled;

  const [state, dispatch] = useEffectReducer<
    jobsReducer.State,
    jobsReducer.Action,
    jobsReducer.Effect
  >(jobsReducer, createInitialJobsState(), {
    "enqueue-job": (_state, effect, dispatch) => {
      fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: effect.id,
          kind: effect.kind,
          title: effect.title,
          params: effect.params,
          subject: effect.subject,
          attemptsSpent: effect.attemptsSpent,
        }),
      })
        .then(async (response) => {
          if (!response.ok) {
            throw new Error(
              (await response.text()) ||
                `The server answered ${response.status}`
            );
          }
          dispatch({ type: "enqueue-succeeded", id: effect.id });
        })
        .catch((error: unknown) =>
          dispatch({
            type: "enqueue-failed",
            id: effect.id,
            message: `Could not queue it: ${error instanceof Error ? error.message : String(error)}`,
          })
        );
    },
    "show-job-succeeded-toast": (_state, effect) =>
      showJobSucceededToast(effect),
    "show-job-failed-toast": (_state, effect) => showJobFailedToast(effect),
    "show-sidecar-not-running-toast": (_state, effect) =>
      showSidecarNotRunningToast(effect),
    "report-job-settled": (_state, effect) => onJobSettledRef.current(effect),
  });

  useJobEventStream(dispatch);

  const startJob = useCallback(
    (request: StartJobRequest): string => {
      const id = crypto.randomUUID();
      dispatch({ type: "job-requested", id, ...request });
      return id;
    },
    [dispatch]
  );

  const dismissJob = useCallback(
    (id: string) => dispatch({ type: "press-dismiss", id }),
    [dispatch]
  );

  const dismissFinishedJobs = useCallback(
    () => dispatch({ type: "idle-timeout-elapsed" }),
    [dispatch]
  );

  return { state, startJob, dismissJob, dismissFinishedJobs };
}
