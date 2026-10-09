import type { EffectReducer } from "use-effect-reducer";
import {
  isPostingJobKind,
  type JobSnapshotMessage,
  type WireJob,
  type WireJobEvent,
} from "./job-wire";
import { toJobsAction } from "./job-event-actions";
import { announceVideoSettled } from "./job-video-toasts";

export { toJobsAction };

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
    /** The last failure's `_tag` (`BufferAuthError`, `JobInterrupted`, …). */
    errorTag: string | null;
    /** The Job this one waits for (a post waits for its export), if any. */
    dependsOn: string | null;
    /** `false` until this tab's enqueue lands: what waits on it is held. */
    enqueued: boolean;
    /** What a post reported once it went out (`posted`): an id, a slug. */
    result: Record<string, unknown> | null;
    /** What the sidecar found when it looked for a cut-off post. */
    postCheck: PostCheckView | null;
    /** The newest Job Event applied: an older or repeated one is ignored. */
    lastEventId: number;
    /**
     * A Batch export's Videos, in the order it announced them; `null` for
     * every other kind, and for a batch that has not announced them yet.
     */
    videos: BatchVideoView[] | null;
  }

  /**
   * One Video of a Batch export. `handed-off`: it failed its tries in the
   * batch and runs on as its own export Job, whose row replaces this one.
   */
  export interface BatchVideoView {
    id: string;
    title: string;
    status: "queued" | "running" | "succeeded" | "failed" | "handed-off";
    stage: string | null;
    percent: number | null;
    errorMessage: string | null;
  }

  /** A `post-check` Job Event: did the interrupted post go out? */
  export interface PostCheckView {
    verdict: "posted" | "not-posted" | "unknown";
    detail: string;
    url: string | null;
  }

  /** What this tab knows of the sidecar, from the stream. */
  export type SidecarStatus = "unknown" | "running" | "not-running";

  export interface State {
    jobs: Record<string, JobView>;
    /** Enqueues held, by the id of the Job they wait on, until it lands. */
    held: Record<string, EnqueueJobEffect[]>;
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
    | StreamFact<
        "job-queued",
        { attempt: number | null; dependsOn: string | null }
      >
    | StreamFact<"job-started", { attempt: number }>
    | StreamFact<"job-stage-entered", { stage: string }>
    | StreamFact<"job-progressed", { stage: string; percent: number }>
    | StreamFact<"job-retrying", { nextAttempt: number; message: string }>
    | StreamFact<"job-requeued", { attempt: number }>
    | StreamFact<"job-succeeded">
    | StreamFact<"job-failed", { message: string; tag: string | null }>
    | StreamFact<"job-interrupted", { message: string; tag: string | null }>
    | StreamFact<"job-posted", { result: Record<string, unknown> }>
    | StreamFact<"job-post-checked", { check: PostCheckView }>
    // A Batch export's Videos
    | StreamFact<
        "batch-videos-announced",
        { videos: { id: string; title: string }[] }
      >
    | StreamFact<
        "batch-video-stage-entered",
        { videoId: string; stage: string }
      >
    | StreamFact<
        "batch-video-progressed",
        { videoId: string; stage: string; percent: number }
      >
    | StreamFact<"batch-video-succeeded", { videoId: string }>
    | StreamFact<"batch-video-failed", { videoId: string; message: string }>
    | StreamFact<"batch-video-handed-off", { videoId: string }>;

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
        /** A Job this one waits for: it runs only once that one succeeds. */
        dependsOn: string | null;
      }
    | { type: "press-dismiss"; id: string }
    /** The author's Retry on a failed or interrupted post. */
    | { type: "press-retry"; id: string }
    | { type: "retry-failed"; id: string; message: string }
    /** Nothing has run for a while: the finished rows have been seen. */
    | { type: "idle-timeout-elapsed" }
    // The enqueue request's outcome
    | { type: "enqueue-succeeded"; id: string }
    | { type: "enqueue-failed"; id: string; message: string }
    // The stream
    | { type: "job-snapshot-received"; snapshot: JobSnapshotMessage }
    | { type: "sidecar-unavailable"; message: string }
    | JobStreamAction;

  export interface EnqueueJobEffect {
    type: "enqueue-job";
    id: string;
    kind: string;
    title: string;
    params: Record<string, unknown>;
    subject: { type: string; id: string } | null;
    attemptsSpent: number;
    dependsOn: string | null;
  }

  export type Effect =
    | EnqueueJobEffect
    | { type: "retry-job"; id: string }
    | { type: "show-retry-failed-toast"; title: string; message: string }
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
  held: {},
  dismissed: {},
  sidecar: "unknown",
  sidecarMessage: null,
});

/** The row id of one Video of a Batch export: `<job id>/<video id>`. */
export const batchVideoRowId = (jobId: string, videoId: string) =>
  `${jobId}/${videoId}`;

/** The Job a row belongs to: the row's own id, or a batch row's Job. */
export const jobIdOfRow = (rowId: string) => rowId.split("/")[0] ?? rowId;

const FINISHED: readonly jobsReducer.JobStatus[] = [
  "succeeded",
  "failed",
  "interrupted",
];

export const isFinishedJob = (job: jobsReducer.JobView) =>
  FINISHED.includes(job.status);

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
  errorTag: null,
  dependsOn: null,
  enqueued: true,
  result: null,
  postCheck: null,
  lastEventId: 0,
  videos: null,
});

/** Apply `change` to one of a batch's Videos; unknown Videos are ignored. */
const updateVideo = (
  job: jobsReducer.JobView,
  videoId: string,
  change: Partial<jobsReducer.BatchVideoView>
): jobsReducer.JobView => ({
  ...job,
  videos:
    job.videos?.map((video) =>
      video.id === videoId ? { ...video, ...change } : video
    ) ?? null,
});

/**
 * A batch announces the Videos it will export. A batch put back by a
 * stopping sidecar announces again, without the ones it already finished:
 * those keep their rows.
 */
const announceVideos = (
  job: jobsReducer.JobView,
  announced: readonly { id: string; title: string }[]
): jobsReducer.JobView => {
  const known = new Map((job.videos ?? []).map((v) => [v.id, v]));
  for (const { id, title } of announced) {
    const before = known.get(id);
    if (before?.status === "succeeded" || before?.status === "handed-off") {
      continue;
    }
    known.set(id, {
      id,
      title,
      status: "queued",
      stage: null,
      percent: null,
      errorMessage: null,
    });
  }
  return { ...job, videos: [...known.values()] };
};

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
      if (action.attempt === null) {
        return { ...job, status: "queued", dependsOn: action.dependsOn };
      }
      // The author's Retry: a fresh run of a finished Job.
      return {
        ...job,
        status: "queued",
        attempt: action.attempt,
        dependsOn: action.dependsOn,
        stage: null,
        percent: null,
        errorMessage: null,
        errorTag: null,
        result: null,
        postCheck: null,
      };
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
      return {
        ...job,
        status: "succeeded",
        errorMessage: null,
        errorTag: null,
      };
    case "job-failed":
      return {
        ...job,
        status: "failed",
        errorMessage: action.message,
        errorTag: action.tag,
      };
    case "job-interrupted":
      return {
        ...job,
        status: "interrupted",
        errorMessage: action.message,
        errorTag: action.tag,
      };
    case "job-posted":
      return { ...job, result: action.result };
    case "job-post-checked":
      return { ...job, postCheck: action.check };
    case "batch-videos-announced":
      return announceVideos(job, action.videos);
    case "batch-video-stage-entered":
      return updateVideo(job, action.videoId, {
        status: "running",
        stage: action.stage,
        percent: 0,
      });
    case "batch-video-progressed":
      return updateVideo(job, action.videoId, {
        status: "running",
        stage: action.stage,
        percent: action.percent,
      });
    case "batch-video-succeeded":
      return updateVideo(job, action.videoId, {
        status: "succeeded",
        stage: null,
        percent: null,
        errorMessage: null,
      });
    case "batch-video-failed":
      return updateVideo(job, action.videoId, {
        status: "failed",
        errorMessage: action.message,
      });
    case "batch-video-handed-off":
      return updateVideo(job, action.videoId, { status: "handed-off" });
  }
};

type Exec = Parameters<
  EffectReducer<jobsReducer.State, jobsReducer.Action, jobsReducer.Effect>
>[2];

/** The toast and the Upload Manager's report for a Job that just settled. */
const announceSettled = (exec: Exec, job: jobsReducer.JobView) => {
  // A Batch export toasts each Video as it finishes (as the browser did), and
  // nothing for the batch itself; only its failure is news.
  if (job.kind === "batch-export" && job.status === "succeeded") return;
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

/** A post cut off mid-run: it waits for the author to check, then Retry. */
export const needsAuthor = (job: jobsReducer.JobView) =>
  job.status === "interrupted" && isPostingJobKind(job.kind);

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

export const jobsReducer: EffectReducer<
  jobsReducer.State,
  jobsReducer.Action,
  jobsReducer.Effect
> = (state, action, exec) => {
  switch (action.type) {
    case "job-requested": {
      const enqueue: jobsReducer.EnqueueJobEffect = {
        type: "enqueue-job",
        id: action.id,
        kind: action.kind,
        title: action.title,
        params: action.params,
        subject: action.subject,
        attemptsSpent: action.attemptsSpent,
        dependsOn: action.dependsOn,
      };
      // The server refuses a `dependsOn` it has not seen yet.
      const parent = action.dependsOn ? state.jobs[action.dependsOn] : null;
      const hold = parent !== null && parent !== undefined && !parent.enqueued;
      let held = state.held;
      if (hold && action.dependsOn) {
        held = {
          ...held,
          [action.dependsOn]: [...(held[action.dependsOn] ?? []), enqueue],
        };
      } else {
        exec(enqueue);
      }
      if (state.sidecar === "not-running") {
        exec({ type: "show-sidecar-not-running-toast", title: action.title });
      }
      return {
        ...state,
        held,
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
            errorTag: null,
            dependsOn: action.dependsOn,
            enqueued: false,
            result: null,
            postCheck: null,
            lastEventId: 0,
            videos: null,
          },
        },
      };
    }

    case "enqueue-succeeded": {
      // The row stays `requested` until the stream says `queued`: the stream
      // is the only word on a Job's state. What waited on it may go now.
      const job = state.jobs[action.id];
      if (!job) return state;
      const { [action.id]: waiting = [], ...held } = state.held;
      for (const enqueue of waiting) exec(enqueue);
      return {
        ...state,
        held,
        jobs: { ...state.jobs, [job.id]: { ...job, enqueued: true } },
      };
    }

    case "enqueue-failed":
      return failRequested(state, action.id, action.message, exec);

    case "press-retry": {
      const job = state.jobs[action.id];
      if (
        !job ||
        !isPostingJobKind(job.kind) ||
        (job.status !== "failed" && job.status !== "interrupted")
      ) {
        return state;
      }
      exec({ type: "retry-job", id: job.id });
      return state;
    }

    case "retry-failed": {
      const job = state.jobs[action.id];
      if (!job) return state;
      exec({
        type: "show-retry-failed-toast",
        title: job.title,
        message: action.message,
      });
      return state;
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
      // A Job's id, or one of a Batch export's rows (`batchVideoRowId`).
      if (!state.jobs[jobIdOfRow(action.id)]) return state;
      return { ...state, dismissed: { ...state.dismissed, [action.id]: true } };
    }

    case "idle-timeout-elapsed": {
      const dismissed = { ...state.dismissed };
      let changed = false;
      for (const job of Object.values(state.jobs)) {
        // An interrupted post waits for the author ("check before
        // retrying"): only they dismiss it.
        if (needsAuthor(job)) continue;
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
    case "job-interrupted":
    case "job-posted":
    case "job-post-checked":
    case "batch-videos-announced":
    case "batch-video-stage-entered":
    case "batch-video-progressed":
    case "batch-video-succeeded":
    case "batch-video-failed":
    case "batch-video-handed-off": {
      const before = state.jobs[action.job.id];
      const after = applyStreamAction(before, action);
      if (!after) return state;
      if (!(before && isFinishedJob(before)) && isFinishedJob(after)) {
        announceSettled(exec, after);
      }
      announceVideoSettled(exec, after, action);
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
