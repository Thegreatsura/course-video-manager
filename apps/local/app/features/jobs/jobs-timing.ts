import type { UploadEntry } from "@/features/upload-manager/upload-entry";
import { ENCODE_STAGES } from "@/features/upload-manager/upload-eta-stages";
import {
  trackTimings,
  type UploadTiming,
} from "@/features/upload-manager/upload-timing";
import { batchVideoRowId, type jobsReducer } from "./jobs-reducer";
import { jobUploadEntries } from "./jobs-selectors";

/**
 * When things happened to each Job's rows: the ETA's input, built from Job
 * Events alone.
 *
 * Two clocks are involved. Every timing is stamped with the event's `at`,
 * which the database wrote, so a stage's duration and a bar's rate never
 * depend on when this tab heard about them (a reopened tab replays the same
 * events and gets the same timings). "Now", though, is this tab's clock.
 * `clockOffsetOf` is how far ahead of the database's clock this tab's runs:
 * the smallest gap between a live event's arrival and its `at` over the
 * newest `CLOCK_SKEW_WINDOW` events, since the smallest gap is the one with
 * the least delivery delay in it (a replay after a reconnect arrives late,
 * and is outweighed). Subtract it from this tab's "now" before comparing
 * with any timing.
 */

/** How many live events the clock offset looks back over. */
export const CLOCK_SKEW_WINDOW = 30;

const rowsOf = (
  job: jobsReducer.JobView | undefined
): Record<string, UploadEntry> =>
  job
    ? Object.fromEntries(
        jobUploadEntries(job).map((row) => [row.uploadId, row])
      )
    : {};

/** The row an event says is encoding: it has an export to do. */
const encodingRowOf = (
  action: jobsReducer.JobStreamAction
): string | undefined => {
  if (!("stage" in action) || !ENCODE_STAGES.includes(action.stage)) {
    return undefined;
  }
  if ("videoId" in action)
    return batchVideoRowId(action.job.id, action.videoId);
  return action.job.kind === "export" ? action.job.id : undefined;
};

/**
 * Every row's timings after one Job Event moved its Job from `before` to
 * `after`. Only that Job's rows change. `replayed`: the event comes from a
 * snapshot, or from a Job this tab joined late (`State.joinedLate`), so the
 * stages it finishes were recorded to the history by a tab that heard them
 * from the start, and are not recorded again.
 */
export const timeJobEvent = (
  timings: Record<string, UploadTiming>,
  before: jobsReducer.JobView | undefined,
  after: jobsReducer.JobView,
  action: jobsReducer.JobStreamAction,
  { replayed }: { replayed: boolean }
): Record<string, UploadTiming> => {
  const previousRows = rowsOf(before);
  const previousTimings: Record<string, UploadTiming> = {};
  for (const id of Object.keys(previousRows)) {
    const timing = timings[id];
    if (timing) previousTimings[id] = timing;
  }
  const next = trackTimings(
    { uploads: previousRows, timings: previousTimings },
    rowsOf(after),
    {
      at: Number.isFinite(action.at) ? action.at : undefined,
      exportWorkId: encodingRowOf(action),
      replayed,
    }
  );
  if (next === previousTimings) return timings;
  const rest = { ...timings };
  for (const id of Object.keys(previousTimings)) delete rest[id];
  return { ...rest, ...next };
};

/** The skews to keep after a Job Event: a live one adds its own. */
export const recordClockSkew = (
  skews: readonly number[],
  action: jobsReducer.JobStreamAction
): readonly number[] =>
  action.receivedAt === null || !Number.isFinite(action.at)
    ? skews
    : [...skews, action.receivedAt - action.at].slice(-CLOCK_SKEW_WINDOW);

/**
 * How far this tab's clock runs ahead of the database's, in ms (negative if
 * behind); 0 until a live event has arrived.
 */
export const clockOffsetOf = (state: jobsReducer.State): number =>
  state.clockSkews.length === 0 ? 0 : Math.min(...state.clockSkews);
