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
