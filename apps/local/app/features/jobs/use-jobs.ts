import { useCallback, useEffect, useRef, useState } from "react";
import { useEffectReducer } from "use-effect-reducer";
import {
  createInitialJobsState,
  jobsReducer,
  toJobsAction,
} from "./jobs-reducer";
import {
  decodeStreamData,
  jobRetryHref,
  JOBS_DISMISS_HREF,
  JOB_STREAM_EVENTS,
  JobEventMessage,
  JobSnapshotMessage,
  SidecarUnavailableMessage,
} from "./job-wire";
import {
  showDismissFailedToast,
  showJobFailedToast,
  showJobSucceededToast,
  showRetryFailedToast,
  showSidecarNotRunningToast,
} from "./job-toasts";
import { createJobEventHub, snapshotJobEvents } from "./job-event-hub";

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
  /** A Job this one waits for (a post waits for its export), or `null`. */
  dependsOn: string | null;
}

/**
 * The bridge to the Sidecar's Job Event stream: one EventSource per tab,
 * which only dispatches what it hears, and passes each Job Event on to the
 * pages listening (`publish`). Closing it cancels nothing.
 */
function useJobEventStream(
  dispatch: Dispatch,
  publish: (heard: JobEventMessage) => void
) {
  useEffect(() => {
    const source = new EventSource("/api/jobs/events");
    source.addEventListener(JOB_STREAM_EVENTS.snapshot, (event) => {
      const snapshot = decodeStreamData(JobSnapshotMessage, event.data);
      if (!snapshot) return;
      dispatch({ type: "job-snapshot-received", snapshot });
      for (const heard of snapshotJobEvents(snapshot)) publish(heard);
    });
    source.addEventListener(JOB_STREAM_EVENTS.jobEvent, (event) => {
      const message = decodeStreamData(JobEventMessage, event.data);
      if (!message) return;
      const action = toJobsAction(message);
      if (action) dispatch(action);
      publish(message);
    });
    source.addEventListener(JOB_STREAM_EVENTS.sidecarAvailable, () =>
      dispatch({ type: "sidecar-available" })
    );
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
  }, [dispatch, publish]);
}

/**
 * This tab's view of the background Jobs, and the one way it starts one.
 * `subscribeToJobEvents` lets a page hear Job Events itself (the editor hears
 * its Clip transcriptions).
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
      const send = () =>
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
            dependsOn: effect.dependsOn,
          }),
        })
          .then(async (response) => {
            if (response.ok) {
              dispatch({ type: "enqueue-succeeded", id: effect.id });
            } else if (response.status < 500) {
              dispatch({
                type: "enqueue-failed",
                id: effect.id,
                message: `Could not queue it: ${(await response.text()) || `the server answered ${response.status}`}`,
              });
            } else {
              dispatch({
                type: "enqueue-unanswered",
                enqueue: effect,
                message: `The server answered ${response.status}`,
              });
            }
          })
          .catch((error: unknown) =>
            dispatch({
              type: "enqueue-unanswered",
              enqueue: effect,
              message: error instanceof Error ? error.message : String(error),
            })
          );
      if (effect.afterMs === 0) {
        void send();
        return;
      }
      const timer = setTimeout(() => void send(), effect.afterMs);
      return () => clearTimeout(timer);
    },
    "retry-job": (_state, effect, dispatch) => {
      fetch(jobRetryHref(effect.id), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attempt: effect.attempt }),
      })
        .then(async (response) => {
          if (!response.ok) {
            throw new Error(
              (await response.text()) ||
                `The server answered ${response.status}`
            );
          }
          // The stream brings the re-queued Job; nothing to do here.
        })
        .catch((error: unknown) =>
          dispatch({
            type: "retry-failed",
            id: effect.id,
            message: error instanceof Error ? error.message : String(error),
          })
        );
    },
    "dismiss-jobs": (_state, effect, dispatch) => {
      fetch(JOBS_DISMISS_HREF, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobIds: effect.ids }),
      })
        .then(async (response) => {
          if (!response.ok) {
            throw new Error(
              (await response.text()) ||
                `The server answered ${response.status}`
            );
          }
          // The stream brings the `dismissed` events to every tab.
        })
        .catch((error: unknown) =>
          dispatch({
            type: "dismiss-failed",
            ids: effect.ids,
            message: error instanceof Error ? error.message : String(error),
          })
        );
    },
    "show-dismiss-failed-toast": (_state, effect) =>
      showDismissFailedToast(effect),
    "show-retry-failed-toast": (_state, effect) => showRetryFailedToast(effect),
    "show-job-succeeded-toast": (state, effect) =>
      showJobSucceededToast(effect, state.jobs[effect.jobId] ?? null),
    "show-job-failed-toast": (_state, effect) => showJobFailedToast(effect),
    "show-sidecar-not-running-toast": (_state, effect) =>
      showSidecarNotRunningToast(effect),
    "report-job-settled": (_state, effect) => onJobSettledRef.current(effect),
  });

  const [hub] = useState(createJobEventHub);
  useJobEventStream(dispatch, hub.publish);

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

  const retryJob = useCallback(
    (id: string) => dispatch({ type: "press-retry", id }),
    [dispatch]
  );

  const dismissFinishedJobs = useCallback(
    () => dispatch({ type: "idle-timeout-elapsed" }),
    [dispatch]
  );

  const clearFinishedJobs = useCallback(
    () => dispatch({ type: "press-clear-finished" }),
    [dispatch]
  );

  return {
    state,
    startJob,
    subscribeToJobEvents: hub.subscribe,
    dismissJob,
    retryJob,
    dismissFinishedJobs,
    clearFinishedJobs,
  };
}
