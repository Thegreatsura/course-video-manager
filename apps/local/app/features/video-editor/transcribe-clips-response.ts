import { Schema } from "effect";
import type { ClipReducerAction, DatabaseId } from "./clip-state-reducer.types";

/**
 * The `transcribe-clips` Job kind (`sidecar/kinds/transcribe-clips.ts`), as
 * both ends name it: the editor enqueues it, and reads its Job Events back.
 */
export const TRANSCRIBE_CLIPS_JOB_KIND = "transcribe-clips";

/**
 * The Job Events a Clip transcription writes, beside the ones every Job has.
 */
export const CLIP_TRANSCRIPTION_EVENTS = {
  /**
   * First, the Clips the run took on: `{ clipIds }`. A tab that sees the Job
   * fail fails whichever of them never settled.
   */
  clipsStarted: "clips-started",
  /** One Clip landed or failed: a `TranscribedClip`. */
  clipSettled: "clip-settled",
} as const;

/**
 * The Clips of `clipIds` that a `transcribe-clips` Job's own Job Events
 * (over every run of it) have not yet settled. A run put back by a
 * deliberate stop takes on only these, so a Clip that already landed is
 * never sent to Whisper twice; and a request for the same Clips joins a live
 * Job only while it still holds all of them.
 */
export const unsettledClipIds = (
  clipIds: ReadonlyArray<string>,
  events: ReadonlyArray<{ readonly type: string; readonly data: unknown }>
): string[] => {
  const settled = new Set<string>();
  for (const event of events) {
    if (event.type !== CLIP_TRANSCRIPTION_EVENTS.clipSettled) continue;
    const id = (event.data as { id?: unknown } | null)?.id;
    if (typeof id === "string") settled.add(id);
  }
  return clipIds.filter((id) => !settled.has(id));
};

/**
 * Whether a live `transcribe-clips` Job (its params and Job Events) still
 * holds exactly the Clips `clipIds` names: the same set, none settled yet.
 */
export const liveJobCoversClips = (
  clipIds: ReadonlyArray<string>,
  live: {
    readonly params: unknown;
    readonly events: ReadonlyArray<{
      readonly type: string;
      readonly data: unknown;
    }>;
  }
): boolean => {
  const liveIds = (live.params as { clipIds?: unknown } | null)?.clipIds;
  if (!Array.isArray(liveIds)) return false;
  const wanted = new Set(clipIds);
  const held = new Set(liveIds as string[]);
  if (held.size !== wanted.size || [...wanted].some((id) => !held.has(id))) {
    return false;
  }
  return unsettledClipIds([...held], live.events).length === held.size;
};

/**
 * One Clip's Transcription, as a `clip-settled` Job Event carries it: either
 * it landed (its new text, and whether it gave the Clip any Transcript
 * Words), or it failed. Both editor paths (a fresh recording's transcribe,
 * and a re-transcribe) turn it into the reducer's `clips-transcribed` event
 * with `toTranscribedClipEvent`, so neither can forget the words half or the
 * failed half.
 */
export const TranscribedClip = Schema.Union(
  Schema.Struct({
    id: Schema.String,
    transcriptionStatus: Schema.Literal("done"),
    text: Schema.String,
    hasTranscriptWords: Schema.Boolean,
  }),
  Schema.Struct({
    id: Schema.String,
    transcriptionStatus: Schema.Literal("failed"),
  })
);
export type TranscribedClip = typeof TranscribedClip.Type;

export const toTranscribedClipEvent = (
  clip: TranscribedClip
): Extract<
  ClipReducerAction,
  { type: "clips-transcribed" }
>["clips"][number] =>
  clip.transcriptionStatus === "done"
    ? {
        databaseId: clip.id as DatabaseId,
        transcriptionStatus: "done",
        text: clip.text,
        hasTranscriptWords: clip.hasTranscriptWords,
      }
    : { databaseId: clip.id as DatabaseId, transcriptionStatus: "failed" };
