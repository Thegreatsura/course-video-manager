import type { EffectReducer } from "use-effect-reducer";
import type { jobsReducer } from "./jobs-reducer";
import { applyStreamAction } from "./jobs-fold";
import { announceVideoSettled } from "./job-video-toasts";
import { announceSettled, loadStageHistory } from "./jobs-settled";
import { isFinishedJob } from "./jobs-dismissal";
import { foldJobEvents, recordClockSkew, timeJobEvent } from "./jobs-timing";
import type { UploadTiming } from "@/features/upload-manager/upload-timing";

/**
 * How `jobsReducer` takes in the Sidecar's stream: the snapshot a tab gets on
 * (re)connecting, and each Job Event after it.
 */

type Exec = Parameters<
  EffectReducer<jobsReducer.State, jobsReducer.Action, jobsReducer.Effect>
>[2];

type SnapshotAction = Extract<
  jobsReducer.Action,
  { type: "job-snapshot-received" }
>;

export const reduceSnapshotReceived = (
  state: jobsReducer.State,
  action: SnapshotAction,
  exec: Exec
): jobsReducer.State => {
  const jobs: Record<string, jobsReducer.JobView> = {};
  let timings: Record<string, UploadTiming> = {};
  for (const { job, events } of action.snapshot.jobs) {
    const folded = foldJobEvents(job, events);
    const view = folded.view;
    jobs[job.id] = view;
    timings = { ...timings, ...folded.timings };
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
  // The Jobs that finished while no tab listened are in the history.
  return loadStageHistory(
    {
      ...state,
      jobs,
      timings,
      snapshotCursor: action.snapshot.cursor,
      joinedLate: {},
      fromCatchUp: {},
      sidecar: "running",
      sidecarMessage: null,
    },
    exec
  );
};

/** Sets `flags[id]` when `on`, keeping the same object when nothing changes. */
const markIf = (
  flags: Record<string, true>,
  id: string,
  on: boolean
): Record<string, true> =>
  on && !flags[id] ? { ...flags, [id]: true } : flags;

/**
 * Where a stream event sits relative to this tab's snapshot: `caughtUp` at or
 * below its cursor, `fromCatchUp` part of the catch-up replay, `late` for a
 * Job this tab first heard of mid-run.
 */
const streamEventOrigin = (
  state: jobsReducer.State,
  action: jobsReducer.JobStreamAction,
  before: jobsReducer.JobView | undefined,
  id: string
) => {
  const caughtUp = action.eventId <= state.snapshotCursor;
  // Only a settlement heard live is news. The catch-up replays Jobs the
  // snapshot left out (finished, dismissed): not news. A Job this tab
  // knew unfinished settling is, even below the cursor (the newest id
  // visible then): a late commit (`job-event-feed.ts`) streams it after.
  const fromCatchUp =
    caughtUp && (before === undefined || state.fromCatchUp[id] === true);
  const late =
    state.joinedLate[id] === true ||
    (before === undefined && (caughtUp || action.type !== "job-queued"));
  return { caughtUp, fromCatchUp, late };
};

export const reduceStreamAction = (
  state: jobsReducer.State,
  action: jobsReducer.JobStreamAction,
  exec: Exec
): jobsReducer.State => {
  const before = state.jobs[action.job.id];
  const after = applyStreamAction(before, action);
  if (!after) return state;
  const { caughtUp, fromCatchUp, late } = streamEventOrigin(
    state,
    action,
    before,
    after.id
  );
  const settled = !(before && isFinishedJob(before)) && isFinishedJob(after);
  if (!fromCatchUp) {
    if (settled) announceSettled(exec, after);
    announceVideoSettled(exec, after, action, before);
  }
  const next: jobsReducer.State = {
    ...state,
    // An event is proof the sidecar is up.
    sidecar: "running",
    sidecarMessage: null,
    jobs: { ...state.jobs, [after.id]: after },
    timings: timeJobEvent(state.timings, before, after, action),
    clockSkews:
      late || caughtUp
        ? state.clockSkews
        : recordClockSkew(state.clockSkews, action),
    joinedLate: markIf(state.joinedLate, after.id, late),
    fromCatchUp: markIf(state.fromCatchUp, after.id, fromCatchUp),
  };
  // A Job that succeeded since the snapshot adds its stages to the
  // history: the snapshot's own load already had the older ones.
  return settled && !fromCatchUp && after.status === "succeeded"
    ? loadStageHistory(next, exec)
    : next;
};
