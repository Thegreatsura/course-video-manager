import type { ClipReducerAction, DatabaseId } from "./clip-state-reducer.types";

/**
 * The part of `POST /clips/transcribe`'s answer the editor reads, per Clip:
 * its new text, and whether the Transcription gave it any Transcript Words.
 * Both callers (a fresh recording's transcribe, and a re-transcribe) turn it
 * into the reducer's `clips-transcribed` event with `toTranscribedClipEvent`,
 * so neither can forget the words half.
 */
export type TranscribedClip = {
  id: string;
  text: string;
  hasTranscriptWords: boolean;
};

export const toTranscribedClipEvent = (
  clip: TranscribedClip
): Extract<
  ClipReducerAction,
  { type: "clips-transcribed" }
>["clips"][number] => ({
  databaseId: clip.id as DatabaseId,
  text: clip.text,
  hasTranscriptWords: clip.hasTranscriptWords,
});
