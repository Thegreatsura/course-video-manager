import type { ClipReducerAction, DatabaseId } from "./clip-state-reducer.types";

/**
 * The part of `POST /clips/transcribe`'s answer the editor reads, per Clip:
 * either the Transcription landed (its new text, and whether it gave the Clip
 * any Transcript Words), or it failed. Both callers (a fresh recording's
 * transcribe, and a re-transcribe) turn it into the reducer's
 * `clips-transcribed` event with `toTranscribedClipEvent`, so neither can
 * forget the words half or the failed half.
 */
export type TranscribedClip =
  | {
      id: string;
      transcriptionStatus: "done";
      text: string;
      hasTranscriptWords: boolean;
    }
  | {
      id: string;
      transcriptionStatus: "failed";
    };

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
