import type { JobEventMessage, JobSnapshotMessage } from "./job-wire";

/**
 * Job Events, passed on to whichever page wants to hear them (the video
 * editor hears its Clip transcriptions). The provider's one EventSource
 * publishes; a page subscribes and dispatches into its own reducer.
 *
 * A page that subscribes late (it mounted after the snapshot came in) first
 * hears the recent events again, oldest first: a page keeps only those newer
 * than what its loader read, by Job Event id.
 */

export type JobEventListener = (heard: JobEventMessage) => void;

/** Subscribe to Job Events; the result unsubscribes. */
export type SubscribeToJobEvents = (listener: JobEventListener) => () => void;

/** How many recent events a late subscriber hears again. */
const HISTORY_LIMIT = 500;

/** A snapshot's events, oldest first across every Job. */
export const snapshotJobEvents = (
  snapshot: JobSnapshotMessage
): JobEventMessage[] =>
  snapshot.jobs
    .flatMap(({ job, events }) => events.map((event) => ({ job, event })))
    .sort((a, b) => a.event.id - b.event.id);

export const createJobEventHub = (historyLimit = HISTORY_LIMIT) => {
  const listeners = new Set<JobEventListener>();
  let history: JobEventMessage[] = [];
  const subscribe: SubscribeToJobEvents = (listener) => {
    for (const heard of history) listener(heard);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };
  const publish = (heard: JobEventMessage) => {
    history = [...history, heard].slice(-historyLimit);
    for (const listener of listeners) listener(heard);
  };
  return { subscribe, publish };
};
