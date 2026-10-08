import type { EffectReducer } from "use-effect-reducer";
import type {
  JobEventMessage,
  JobSnapshotMessage,
  WireJob,
  WireJobEvent,
} from "./job-wire";

/**
 * Background **Jobs** as this tab sees them: built only from the **Job
 * Events** the Sidecar streams (`job-wire.ts`), plus the requests this tab
 * made. The tab runs nothing, retries nothing and cancels nothing — the
 * sidecar decides all of that — so closing it loses nothing either.
 *
 * Toasts are decisions here, on a Job settling, rather than a diff of two
 * snapshots (the Upload Manager's `planUploadReactions`). So is telling the
 * Upload Manager that a Job its own uploads wait on has settled.
 */
export namespace jobsReducer {
  /**
   * - `requested`: this tab asked for it; the sidecar has not reported it yet.
   * - `queued`: waiting for the sidecar (a Job put back by a stopping
   *   sidecar is `queued` again, at the same attempt).
   * - `retrying`: an attempt failed and the next one waits in the queue.
   */
  export type JobStatus =
    | "requested"
    | "queued"
    | "running"
    | "retrying"
    | "succeeded"
    | "failed"
    | "interrupted";

  export interface JobView {
    id: string;
    kind: string;
    title: string;
    subjectType: string | null;
    subjectId: string | null;
    status: JobStatus;
    attempt: number;
    /** The stage the work last reported, and how far into it (0–100). */
    stage: string | null;
    percent: number | null;
    /** The last failed attempt's message, kept while it retries. */
    errorMessage: string | null;
    /** The newest Job Event applied: an older or repeated one is ignored. */
    lastEventId: number;
  }

  /** What this tab knows of the sidecar, from the stream. */
  export type SidecarStatus = "unknown" | "running" | "not-running";

  export interface State {
    jobs: Record<string, JobView>;
    /** Hidden by the author (or the idle timer); events still update nothing visible. */
    dismissed: Record<string, true>;
    sidecar: SidecarStatus;
    /** Why the sidecar is `not-running`, as the proxy put it. */
    sidecarMessage: string | null;
  }

  /** A Job Event from the stream, as a fact about one Job. */
  type StreamFact<T extends string, D = object> = {
    type: T;
    job: WireJob;
    eventId: number;
  } & D;

  /** A Job Event this reducer understands (see `toJobsAction`). */
  export type JobStreamAction =
    | StreamFact<"job-queued">
    | StreamFact<"job-started", { attempt: number }>
    | StreamFact<"job-stage-entered", { stage: string }>
    | StreamFact<"job-progressed", { stage: string; percent: number }>
    | StreamFact<"job-retrying", { nextAttempt: number; message: string }>
    | StreamFact<"job-requeued", { attempt: number }>
    | StreamFact<"job-succeeded">
    | StreamFact<"job-failed", { message: string }>
    | StreamFact<"job-interrupted", { message: string }>;

  export type Action =
    // Gestures and requests from this tab
    | {
        type: "job-requested";
        /** Chosen by the provider (`crypto.randomUUID()`), never here. */
        id: string;
        kind: string;
        title: string;
        params: Record<string, unknown>;
        subject: { type: string; id: string } | null;
        attemptsSpent: number;
      }
    | { type: "press-dismiss"; id: string }
    /** Nothing has run for a while: the finished rows have been seen. */
    | { type: "idle-timeout-elapsed" }
    // The enqueue request's outcome
    | { type: "enqueue-succeeded"; id: string }
    | { type: "enqueue-failed"; id: string; message: string }
    // The stream
    | { type: "job-snapshot-received"; snapshot: JobSnapshotMessage }
    | { type: "sidecar-unavailable"; message: string }
    | JobStreamAction;

  export type Effect =
    | {
        type: "enqueue-job";
        id: string;
        kind: string;
        title: string;
        params: Record<string, unknown>;
        subject: { type: string; id: string } | null;
        attemptsSpent: number;
      }
    | {
        type: "show-job-succeeded-toast";
        jobId: string;
        kind: string;
        title: string;
        subjectId: string | null;
      }
    | {
        type: "show-job-failed-toast";
        jobId: string;
        kind: string;
        title: string;
        message: string;
        /** `false` when the sidecar never saw it (the enqueue failed): no log. */
        hasLog: boolean;
      }
    | { type: "show-sidecar-not-running-toast"; title: string }
    | {
        /** Tell the Upload Manager: uploads may be waiting on this Job. */
        type: "report-job-settled";
        jobId: string;
        title: string;
        outcome: "succeeded" | "failed";
      };
}

export const createInitialJobsState = (): jobsReducer.State => ({
  jobs: {},
  dismissed: {},
  sidecar: "unknown",
  sidecarMessage: null,
});

const FINISHED: readonly jobsReducer.JobStatus[] = [
  "succeeded",
  "failed",
  "interrupted",
];

export const isFinishedJob = (job: jobsReducer.JobView) =>
  FINISHED.includes(job.status);

const errorMessageOf = (data: Record<string, unknown>): string => {
  const error = data.error;
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }
  return "The job failed";
};

const numberOr = (value: unknown, fallback: number) =>
  typeof value === "number" ? value : fallback;

/**
 * One Job Event off the wire as a reducer action, or `null` for a type this
 * tab has no use for. `event.type` is what `db-job-operations` and the
 * handlers write: `queued`, `started`, `stage`, `progress`, `retrying`,
 * `requeued`, `succeeded`, `failed`, `interrupted`.
 */
export const toJobsAction = (
  message: JobEventMessage
): jobsReducer.JobStreamAction | null => {
  const { job, event } = message;
  const base = { job, eventId: event.id };
  const data = event.data;
  switch (event.type) {
    case "queued":
      return { ...base, type: "job-queued" };
    case "started":
      return {
        ...base,
        type: "job-started",
        attempt: numberOr(data.attempt, job.attempt),
      };
    case "stage":
      return typeof data.stage === "string"
        ? { ...base, type: "job-stage-entered", stage: data.stage }
        : null;
    case "progress":
      return typeof data.stage === "string" && typeof data.percent === "number"
        ? {
            ...base,
            type: "job-progressed",
            stage: data.stage,
            percent: data.percent,
          }
        : null;
    case "retrying":
      return {
        ...base,
        type: "job-retrying",
        nextAttempt: numberOr(data.nextAttempt, job.attempt),
        message: errorMessageOf(data),
      };
    case "requeued":
      return {
        ...base,
        type: "job-requeued",
        attempt: numberOr(data.attempt, job.attempt),
      };
    case "succeeded":
      return { ...base, type: "job-succeeded" };
    case "failed":
      return { ...base, type: "job-failed", message: errorMessageOf(data) };
    case "interrupted":
      return {
        ...base,
        type: "job-interrupted",
        message: errorMessageOf(data),
      };
    default:
      return null;
  }
};

const viewOf = (
  job: WireJob,
  status: jobsReducer.JobStatus
): jobsReducer.JobView => ({
  id: job.id,
  kind: job.kind,
  title: job.title,
  subjectType: job.subjectType,
  subjectId: job.subjectId,
  status,
  attempt: job.attempt,
  stage: null,
  percent: null,
  errorMessage: null,
  lastEventId: 0,
});

/**
 * Apply one Job Event to what is known of its Job: the whole state machine,
 * shared by the live stream and the snapshot's replay. `undefined` when the
 * event was already applied.
 */
const applyStreamAction = (
  known: jobsReducer.JobView | undefined,
  action: jobsReducer.JobStreamAction
): jobsReducer.JobView | undefined => {
  if (known && action.eventId <= known.lastEventId) return undefined;
  const job: jobsReducer.JobView = {
    ...(known ?? viewOf(action.job, "queued")),
    // The sidecar's word on the title wins over what this tab asked for.
    title: action.job.title,
    lastEventId: action.eventId,
  };
  switch (action.type) {
    case "job-queued":
      return { ...job, status: "queued" };
    case "job-started":
      return {
        ...job,
        status: "running",
        attempt: action.attempt,
        stage: null,
        percent: null,
      };
    case "job-stage-entered":
      return { ...job, stage: action.stage, percent: 0 };
    case "job-progressed":
      return { ...job, stage: action.stage, percent: action.percent };
    case "job-retrying":
      return {
        ...job,
        status: "retrying",
        attempt: action.nextAttempt,
        errorMessage: action.message,
        stage: null,
        percent: null,
      };
    case "job-requeued":
      return {
        ...job,
        status: "queued",
        attempt: action.attempt,
        stage: null,
        percent: null,
      };
    case "job-succeeded":
      return { ...job, status: "succeeded", errorMessage: null };
    case "job-failed":
      return { ...job, status: "failed", errorMessage: action.message };
    case "job-interrupted":
      return { ...job, status: "interrupted", errorMessage: action.message };
  }
};

type Exec = Parameters<
  EffectReducer<jobsReducer.State, jobsReducer.Action, jobsReducer.Effect>
>[2];

/** The toast and the Upload Manager's report for a Job that just settled. */
const announceSettled = (exec: Exec, job: jobsReducer.JobView) => {
  if (job.status === "succeeded") {
    exec({
      type: "show-job-succeeded-toast",
      jobId: job.id,
      kind: job.kind,
      title: job.title,
      subjectId: job.subjectId,
    });
    exec({
      type: "report-job-settled",
      jobId: job.id,
      title: job.title,
      outcome: "succeeded",
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
  exec({
    type: "report-job-settled",
    jobId: job.id,
    title: job.title,
    outcome: "failed",
  });
};

/** Fold one Job's events from a snapshot, oldest first. */
const foldSnapshotJob = (
  job: WireJob,
  events: readonly WireJobEvent[]
): jobsReducer.JobView => {
  let view: jobsReducer.JobView = viewOf(job, "queued");
  for (const event of events) {
    const action = toJobsAction({ job, event });
    if (!action) continue;
    view = applyStreamAction(view, action) ?? view;
  }
  return view;
};

export const jobsReducer: EffectReducer<
  jobsReducer.State,
  jobsReducer.Action,
  jobsReducer.Effect
> = (state, action, exec) => {
  switch (action.type) {
    case "job-requested": {
      exec({
        type: "enqueue-job",
        id: action.id,
        kind: action.kind,
        title: action.title,
        params: action.params,
        subject: action.subject,
        attemptsSpent: action.attemptsSpent,
      });
      if (state.sidecar === "not-running") {
        exec({ type: "show-sidecar-not-running-toast", title: action.title });
      }
      return {
        ...state,
        jobs: {
          ...state.jobs,
          [action.id]: {
            id: action.id,
            kind: action.kind,
            title: action.title,
            subjectType: action.subject?.type ?? null,
            subjectId: action.subject?.id ?? null,
            status: "requested",
            attempt: action.attemptsSpent + 1,
            stage: null,
            percent: null,
            errorMessage: null,
            lastEventId: 0,
          },
        },
      };
    }

    case "enqueue-succeeded":
      // The row stays `requested` until the stream says `queued`: the stream
      // is the only word on a Job's state.
      return state;

    case "enqueue-failed": {
      const job = state.jobs[action.id];
      if (!job || job.status !== "requested") return state;
      const failed: jobsReducer.JobView = {
        ...job,
        status: "failed",
        errorMessage: action.message,
      };
      exec({
        type: "show-job-failed-toast",
        jobId: job.id,
        kind: job.kind,
        title: job.title,
        message: action.message,
        hasLog: false,
      });
      exec({
        type: "report-job-settled",
        jobId: job.id,
        title: job.title,
        outcome: "failed",
      });
      return { ...state, jobs: { ...state.jobs, [job.id]: failed } };
    }

    case "job-snapshot-received": {
      const jobs: Record<string, jobsReducer.JobView> = {};
      for (const { job, events } of action.snapshot.jobs) {
        const view = foldSnapshotJob(job, events);
        jobs[job.id] = view;
        // A Job this tab was following settled while it was not listening:
        // that is still news, to the author and to anything waiting on it.
        const before = state.jobs[job.id];
        if (before && !isFinishedJob(before) && isFinishedJob(view)) {
          announceSettled(exec, view);
        }
      }
      // A request still on its way to the server is not in any snapshot yet.
      for (const job of Object.values(state.jobs)) {
        if (job.status === "requested" && !jobs[job.id]) jobs[job.id] = job;
      }
      return { ...state, jobs, sidecar: "running", sidecarMessage: null };
    }

    case "sidecar-unavailable":
      return {
        ...state,
        sidecar: "not-running",
        sidecarMessage: action.message,
      };

    case "press-dismiss": {
      if (!state.jobs[action.id]) return state;
      return { ...state, dismissed: { ...state.dismissed, [action.id]: true } };
    }

    case "idle-timeout-elapsed": {
      const dismissed = { ...state.dismissed };
      let changed = false;
      for (const job of Object.values(state.jobs)) {
        if (isFinishedJob(job) && !dismissed[job.id]) {
          dismissed[job.id] = true;
          changed = true;
        }
      }
      return changed ? { ...state, dismissed } : state;
    }

    case "job-queued":
    case "job-started":
    case "job-stage-entered":
    case "job-progressed":
    case "job-retrying":
    case "job-requeued":
    case "job-succeeded":
    case "job-failed":
    case "job-interrupted": {
      const before = state.jobs[action.job.id];
      const after = applyStreamAction(before, action);
      if (!after) return state;
      if (!(before && isFinishedJob(before)) && isFinishedJob(after)) {
        announceSettled(exec, after);
      }
      return {
        ...state,
        // An event is proof the sidecar is up.
        sidecar: "running",
        sidecarMessage: null,
        jobs: { ...state.jobs, [after.id]: after },
      };
    }
  }
};
