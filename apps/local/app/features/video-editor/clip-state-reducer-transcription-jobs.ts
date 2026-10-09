import { Either, Schema } from "effect";
import type { JobEventMessage } from "@/features/jobs/job-wire";
import type {
  ClipReducerExec,
  ClipReducerState,
  ClipTranscriptionJob,
  DatabaseId,
  FrontendId,
  TimelineItem,
} from "./clip-state-reducer.types";
import {
  CLIP_TRANSCRIPTION_EVENTS,
  TranscribedClip,
} from "./transcribe-clips-response";

/**
 * The clip reducer's half of a Clip transcription. The Sidecar runs it as a
 * `transcribe-clips` Job: the editor asks for one under an id it made, then
 * hears its Job Events (`job-event-heard`). Each Clip belongs to one Job at a
 * time (`clipTranscriptionJobs`): the one this window asked for, until a Job
 * is heard starting on it. Only that Job's result lands on the Clip, and only
 * its failure fails the Clip.
 */

type Holders = ClipReducerState["clipTranscriptionJobs"];

/**
 * Ask for a Job that transcribes these Clips. A Clip already waiting on a Job
 * this window asked for (one that has not started) is left out: that was a
 * second click. A Clip a running Job holds may be asked for again, and the
 * new Job takes it, so the old one's end no longer touches it.
 */
export const requestClipTranscription = (
  state: ClipReducerState,
  frontendIds: readonly FrontendId[],
  jobId: string,
  exec: ClipReducerExec
): ClipReducerState => {
  const requested = new Set(frontendIds);
  const clipIds: DatabaseId[] = [];
  for (const item of state.items) {
    if (item.type !== "on-database" || !requested.has(item.frontendId)) {
      continue;
    }
    const holder = state.clipTranscriptionJobs[item.databaseId];
    if (holder && !holder.started) continue;
    clipIds.push(item.databaseId);
  }
  if (clipIds.length === 0) return state;
  exec({ type: "transcribe-clips", jobId, clipIds });
  return holdForRequestedJob(state, clipIds, jobId);
};

/**
 * These Clips wait on a Job this window has just asked for: they show
 * `transcribing`, and belong to it until a Job is heard starting on them.
 */
export const holdForRequestedJob = (
  state: ClipReducerState,
  clipIds: readonly DatabaseId[],
  jobId: string
): ClipReducerState => {
  const held = new Set(clipIds);
  const clipTranscriptionJobs: Holders = { ...state.clipTranscriptionJobs };
  for (const id of clipIds)
    clipTranscriptionJobs[id] = { jobId, started: false };
  return {
    ...state,
    clipTranscriptionJobs,
    items: state.items.map((item) =>
      item.type === "on-database" && held.has(item.databaseId)
        ? { ...item, transcriptionStatus: "transcribing" as const }
        : item
    ),
  };
};

/**
 * The server answered the request for `requestedJobId` with the live Job
 * `jobId` (it already holds the same Clips), so no Job `requestedJobId` will
 * ever run: the Clips waiting on it follow `jobId` instead, its result and
 * its end alike. What `jobId` said about them before this answer came (its
 * events and the answer travel apart) applies now.
 */
export const followJoinedJob = (
  state: ClipReducerState,
  requestedJobId: string,
  jobId: string
): ClipReducerState => {
  const waiting = Object.entries(state.clipTranscriptionJobs).filter(
    ([, holder]) => holder.jobId === requestedJobId
  );
  if (waiting.length === 0) return state;
  const clipTranscriptionJobs: Holders = { ...state.clipTranscriptionJobs };
  const heardEarly = new Map<number, JobEventMessage>();
  for (const [clipId, holder] of waiting) {
    clipTranscriptionJobs[clipId as DatabaseId] = {
      jobId,
      started: holder.started,
    };
    for (const heard of holder.heardBeforeJoin ?? []) {
      if (heard.job.id === jobId) heardEarly.set(heard.event.id, heard);
    }
  }
  return [...heardEarly.values()]
    .sort((a, b) => a.event.id - b.event.id)
    .reduce(applyJobEvent, { ...state, clipTranscriptionJobs });
};

const ClipsStarted = Schema.Struct({ clipIds: Schema.Array(Schema.String) });

/**
 * One Job Event of this Video's `transcribe-clips` Jobs. One at or below
 * `jobEventCursor` is already in the Clips (the loader read them after it),
 * or was applied here before: it only says which Job holds which Clip, so a
 * tab opened mid-Job knows the Job whose end fails its Clips.
 */
export const applyTranscriptionJobEvent = (
  state: ClipReducerState,
  heard: JobEventMessage
): ClipReducerState => {
  if (heard.event.id <= state.jobEventCursor) {
    const replayed = applyJobEvent(state, heard);
    return replayed.clipTranscriptionJobs === state.clipTranscriptionJobs
      ? state
      : { ...state, clipTranscriptionJobs: replayed.clipTranscriptionJobs };
  }
  return applyJobEvent(
    keepForJoin({ ...state, jobEventCursor: heard.event.id }, heard),
    heard
  );
};

const applyJobEvent = (
  state: ClipReducerState,
  { job, event }: JobEventMessage
): ClipReducerState => {
  switch (event.type) {
    case CLIP_TRANSCRIPTION_EVENTS.clipsStarted: {
      const started = Schema.decodeUnknownEither(ClipsStarted)(event.data);
      return Either.isRight(started)
        ? jobStarted(state, job.id, started.right.clipIds as DatabaseId[])
        : state;
    }
    case CLIP_TRANSCRIPTION_EVENTS.clipSettled: {
      const clip = Schema.decodeUnknownEither(TranscribedClip)(event.data);
      return Either.isRight(clip)
        ? clipSettled(state, job.id, clip.right)
        : state;
    }
    case "failed":
    case "interrupted":
      return jobEnded(state, job.id);
    default:
      return state;
  }
};

/**
 * A Clip waiting on a Job this window asked for may yet follow another Job
 * the server joins it to: keep what another Job says about it (its result,
 * or that the Job ended) until the Clip's own Job starts or the join answer
 * comes (`followJoinedJob`).
 */
const keepForJoin = (
  state: ClipReducerState,
  heard: JobEventMessage
): ClipReducerState => {
  const { type, data } = heard.event;
  const ended = type === "failed" || type === "interrupted";
  const settledClipId =
    type === CLIP_TRANSCRIPTION_EVENTS.clipSettled ? data.id : undefined;
  if (!ended && settledClipId === undefined) return state;
  const clipTranscriptionJobs: Holders = { ...state.clipTranscriptionJobs };
  let kept = false;
  for (const [clipId, holder] of Object.entries(state.clipTranscriptionJobs)) {
    if (holder.started || holder.jobId === heard.job.id) continue;
    if (!ended && clipId !== settledClipId) continue;
    clipTranscriptionJobs[clipId as DatabaseId] = {
      ...holder,
      heardBeforeJoin: [...(holder.heardBeforeJoin ?? []), heard],
    };
    kept = true;
  }
  return kept ? { ...state, clipTranscriptionJobs } : state;
};

/**
 * Which Job a Clip belongs to once `jobId` is heard starting on it. A Job
 * that starts later than the one holding the Clip is the newer one, so it
 * takes the Clip; but a Job this window asked for keeps it until it starts.
 */
const holderAfterStart = (
  holder: ClipTranscriptionJob | undefined,
  jobId: string
): ClipTranscriptionJob | undefined => {
  if (!holder || holder.jobId === jobId || holder.started) {
    return { jobId, started: true };
  }
  return undefined;
};

/** A Job took these Clips on: each one it now holds is `transcribing`. */
const jobStarted = (
  state: ClipReducerState,
  jobId: string,
  clipIds: readonly DatabaseId[]
): ClipReducerState => {
  const clipTranscriptionJobs: Holders = { ...state.clipTranscriptionJobs };
  const taken = new Set<DatabaseId>();
  for (const id of clipIds) {
    const holder = holderAfterStart(clipTranscriptionJobs[id], jobId);
    if (!holder) continue;
    clipTranscriptionJobs[id] = holder;
    taken.add(id);
  }
  return {
    ...state,
    clipTranscriptionJobs,
    items: state.items.map((item) =>
      item.type === "on-database" &&
      taken.has(item.databaseId) &&
      item.transcriptionStatus !== "transcribing"
        ? { ...item, transcriptionStatus: "transcribing" as const }
        : item
    ),
  };
};

/**
 * One Clip's Transcription landed or failed. It lands unless another Job
 * holds the Clip: then that Job's result is the one to show.
 */
const clipSettled = (
  state: ClipReducerState,
  jobId: string,
  clip: TranscribedClip
): ClipReducerState => {
  const databaseId = clip.id as DatabaseId;
  const holder = state.clipTranscriptionJobs[databaseId];
  if (holder && holder.jobId !== jobId) return state;
  const { [databaseId]: _settled, ...released } = state.clipTranscriptionJobs;
  const clipTranscriptionJobs = holder ? released : state.clipTranscriptionJobs;
  const withWords = new Set(state.clipIdsWithTranscriptWords);

  const items = state.items.map((item) => {
    if (item.type !== "on-database" || item.databaseId !== databaseId) {
      return item;
    }
    // A failed Transcription leaves the Clip's text and words as they
    // were: only its status changes.
    if (clip.transcriptionStatus === "failed") {
      return { ...item, transcriptionStatus: "failed" as const };
    }
    // An empty text is a finished transcription too (nothing was said).
    if (clip.hasTranscriptWords) withWords.add(databaseId);
    else withWords.delete(databaseId);
    return {
      ...item,
      text: clip.text,
      transcriptionStatus: "done" as const,
    };
  });

  return {
    ...state,
    items,
    clipIdsWithTranscriptWords: withWords,
    clipTranscriptionJobs,
  };
};

/**
 * The Job ended (failed or interrupted) without settling the Clips it still
 * holds: each shows it failed and can be retried. A Clip a newer Job has
 * taken on is that Job's. A Clip loaded `transcribing` that no Job holds here
 * was taken on before this tab heard of it; one of this Video's Jobs ending
 * is the only word it will get, so it fails too (a Job still running on it
 * lands its result over this when it settles).
 */
const jobEnded = (state: ClipReducerState, jobId: string): ClipReducerState => {
  const held = new Set(
    Object.entries(state.clipTranscriptionJobs)
      .filter(([, holder]) => holder.jobId === jobId)
      .map(([clipId]) => clipId)
  );
  const fails = (item: TimelineItem) =>
    item.type === "on-database" &&
    item.transcriptionStatus === "transcribing" &&
    (held.has(item.databaseId) ||
      !(item.databaseId in state.clipTranscriptionJobs));
  if (held.size === 0 && !state.items.some(fails)) return state;
  const clipTranscriptionJobs: Holders =
    held.size === 0
      ? state.clipTranscriptionJobs
      : Object.fromEntries(
          Object.entries(state.clipTranscriptionJobs).filter(
            ([clipId]) => !held.has(clipId)
          )
        );
  return {
    ...state,
    clipTranscriptionJobs,
    items: state.items.map((item) =>
      fails(item) && item.type === "on-database"
        ? { ...item, transcriptionStatus: "failed" as const }
        : item
    ),
  };
};
