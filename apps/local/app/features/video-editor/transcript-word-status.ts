import type {
  ClipOnDatabase,
  ClipReducerState,
} from "./clip-state-reducer.types";
import { WHITE_NOISE_DEFAULTS } from "./clip-state-reducer-effect-clip-helpers";

/**
 * Where a Clip stands with its Transcript Words. The one place the editor's
 * "Missing word timing" warning is decided, so that a Clip which is still on
 * its way to having words is never mistaken for one that never will.
 *
 * - `transcribing` — a Transcription is queued or in flight. Its words arrive
 *   with it, so this is a valid state, not a missing one.
 * - `has-words` — the Clip has its Transcript Words.
 * - `nothing-to-time` — there are no spoken words to time: an Effect Clip
 *   (white noise), or a Clip with no text (nothing was said, or it has not
 *   been transcribed at all — a different problem, shown on the Clip itself).
 * - `missing` — the Clip has text but no words: it was transcribed before
 *   Transcript Words existed and never re-transcribed (#1567). The only status
 *   the warning is about, and the only one re-transcribing fixes.
 */
export type TranscriptWordStatus =
  "transcribing" | "has-words" | "nothing-to-time" | "missing";

type WordState = Pick<
  ClipReducerState,
  "clipIdsBeingTranscribed" | "clipIdsWithTranscriptWords"
>;

export const getTranscriptWordStatus = (
  clip: Pick<ClipOnDatabase, "frontendId" | "databaseId" | "text" | "scene">,
  state: WordState
): TranscriptWordStatus => {
  if (state.clipIdsBeingTranscribed.has(clip.frontendId)) return "transcribing";
  if (state.clipIdsWithTranscriptWords.has(clip.databaseId)) return "has-words";
  if (clip.scene === WHITE_NOISE_DEFAULTS.scene) return "nothing-to-time";
  if (clip.text.trim() === "") return "nothing-to-time";
  return "missing";
};

/**
 * Whether the Video should show "Missing word timing": some live Clip on the
 * database is `missing`. A Clip still being recorded (optimistically added)
 * has no row yet, so it is on its way to a Transcription, not missing words.
 */
export const anyClipsMissingTranscriptWords = (
  state: WordState & Pick<ClipReducerState, "items">
): boolean =>
  state.items.some(
    (item) =>
      item.type === "on-database" &&
      !item.shouldArchive &&
      getTranscriptWordStatus(item, state) === "missing"
  );
