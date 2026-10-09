import { Either, Schema } from "effect";
import type { JobEventMessage } from "@/features/jobs/job-wire";
import type {
  ClipReducerExec,
  ClipReducerState,
  ClipTranscriptionJob,
  DatabaseId,
  FrontendId,
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
 * its end alike.
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
  for (const [clipId, holder] of waiting) {
    clipTranscriptionJobs[clipId as DatabaseId] = { ...holder, jobId };
  }
  return { ...state, clipTranscriptionJobs };
};

const ClipsStarted = Schema.Struct({ clipIds: Schema.Array(Schema.String) });

/**
 * One Job Event of this Video's `transcribe-clips` Jobs. One at or below
 * `jobEventCursor` is already in the Clips (the loader read them after it),
 * or was applied here before, so it is ignored.
 */
export const applyTranscriptionJobEvent = (
  state: ClipReducerState,
  { job, event }: JobEventMessage
): ClipReducerState => {
  if (event.id <= state.jobEventCursor) return state;
  const heard = { ...state, jobEventCursor: event.id };
  switch (event.type) {
    case CLIP_TRANSCRIPTION_EVENTS.clipsStarted: {
      const started = Schema.decodeUnknownEither(ClipsStarted)(event.data);
      return Either.isRight(started)
        ? jobStarted(heard, job.id, started.right.clipIds as DatabaseId[])
        : heard;
    }
    case CLIP_TRANSCRIPTION_EVENTS.clipSettled: {
      const clip = Schema.decodeUnknownEither(TranscribedClip)(event.data);
      return Either.isRight(clip)
        ? clipSettled(heard, job.id, clip.right)
        : heard;
    }
    case "failed":
    case "interrupted":
      return jobEnded(heard, job.id);
    default:
      return heard;
  }
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
  const { [databaseId]: _settled, ...clipTranscriptionJobs } =
    state.clipTranscriptionJobs;
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
 * taken on is that Job's.
 */
const jobEnded = (state: ClipReducerState, jobId: string): ClipReducerState => {
  const held = new Set(
    Object.entries(state.clipTranscriptionJobs)
      .filter(([, holder]) => holder.jobId === jobId)
      .map(([clipId]) => clipId)
  );
  if (held.size === 0) return state;
  const clipTranscriptionJobs: Holders = Object.fromEntries(
    Object.entries(state.clipTranscriptionJobs).filter(
      ([clipId]) => !held.has(clipId)
    )
  );
  return {
    ...state,
    clipTranscriptionJobs,
    items: state.items.map((item) =>
      item.type === "on-database" &&
      held.has(item.databaseId) &&
      item.transcriptionStatus === "transcribing"
        ? { ...item, transcriptionStatus: "failed" as const }
        : item
    ),
  };
};
