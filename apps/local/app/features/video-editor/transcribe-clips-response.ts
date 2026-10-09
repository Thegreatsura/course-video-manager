import { Schema } from "effect";

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
 * Words), or it failed. The clip reducer lands it on the Clip
 * (`clip-state-reducer-transcription-jobs.ts`).
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
