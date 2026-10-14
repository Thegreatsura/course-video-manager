/**
 * A Short's burned-in subtitles, worked out from its **Clips** alone (#2172).
 *
 * The text is each Clip's own text, the part of the Video's Transcript the
 * author edits. The timing is its **Transcript Words**. Nothing is transcribed
 * again: the render used to run Whisper a second time over the concatenated
 * file, so its subtitles drifted from the Clips and ignored edits to them.
 *
 * The subtitles leave no gap. The first starts at frame 0, so the opening
 * phrase is already on screen before the first word. Each one ends on the frame
 * the next one starts (`endFrame` is exclusive), and the last runs to the end
 * of the Short.
 */
import { Effect } from "effect";
import { ClipOperationsService } from "@/services/db-clip-operations.server";
import { splitSubtitleSegments } from "@/lib/subtitle-chunks";

/** One subtitle as the overlay renderer takes it; `endFrame` is exclusive. */
export type ShortSubtitle = {
  startFrame: number;
  endFrame: number;
  text: string;
};

/** A Clip as the subtitles see it, in timeline order. */
type ShortSubtitleClip = {
  text: string;
  /** Seconds the Clip takes on the Short's timeline, exactly as the concat is asked for it. */
  durationSeconds: number;
  /** Its Transcript Words in spoken order, Clip-relative seconds. May be empty. */
  words: readonly { start: number; text: string }[];
};

/** Only letters and digits count when the text is matched to the words, so punctuation and Whisper's hyphen splits (`on -the -ground`) don't shift it. */
const countLetters = (text: string) =>
  text.match(/[\p{L}\p{N}]/gu)?.length ?? 0;

/**
 * When, in Clip-relative seconds, the letter at `fraction` of the Clip's text
 * is said. It lands on the start of the word holding that letter. A Clip
 * with no Transcript Words (filmed before they existed) shares its span out by
 * letter count.
 */
const clipTimeAt = (clip: ShortSubtitleClip, fraction: number): number => {
  const totalWordLetters = clip.words.reduce(
    (sum, word) => sum + countLetters(word.text),
    0
  );
  if (totalWordLetters === 0) return fraction * clip.durationSeconds;
  const target = fraction * totalWordLetters;
  let seen = 0;
  for (const word of clip.words) {
    seen += countLetters(word.text);
    if (seen > target) return Math.min(word.start, clip.durationSeconds);
  }
  return Math.min(clip.words.at(-1)!.start, clip.durationSeconds);
};

/** The Clip's text cut into phrases by the ≤32-char rule, each at the Clip-relative time it starts. */
const clipPhrases = (clip: ShortSubtitleClip) => {
  const phrases = splitSubtitleSegments({
    start: 0,
    end: 0,
    text: clip.text.trim(),
  })
    .map((chunk) => chunk.text)
    .filter((text) => text.length > 0);
  const totalLetters = countLetters(clip.text);
  if (totalLetters === 0) return [];
  let lettersBefore = 0;
  return phrases.map((text) => {
    const start = clipTimeAt(clip, lettersBefore / totalLetters);
    lettersBefore += countLetters(text);
    return { start, text };
  });
};

function shortSubtitles(
  clips: readonly ShortSubtitleClip[],
  fps: number
): { subtitles: ShortSubtitle[]; durationInFrames: number } {
  const totalSeconds = clips.reduce(
    (sum, clip) => sum + clip.durationSeconds,
    0
  );
  const durationInFrames = Math.ceil(totalSeconds * fps);

  const starts: { startFrame: number; text: string }[] = [];
  let clipOffset = 0;
  for (const clip of clips) {
    for (const phrase of clipPhrases(clip)) {
      const previous = starts.at(-1);
      // The first is on screen from frame 0; every other one lasts at least a frame.
      const startFrame = previous
        ? Math.max(
            Math.round((clipOffset + phrase.start) * fps),
            previous.startFrame + 1
          )
        : 0;
      if (startFrame >= durationInFrames) break;
      starts.push({ startFrame, text: phrase.text });
    }
    clipOffset += clip.durationSeconds;
  }

  const subtitles = starts.map((subtitle, index) => ({
    startFrame: subtitle.startFrame,
    endFrame: starts[index + 1]?.startFrame ?? durationInFrames,
    text: subtitle.text,
  }));
  return { subtitles, durationInFrames };
}

/** {@link shortSubtitles} for a Short's Clips, their Transcript Words read from the database. */
export const loadShortSubtitles = Effect.fn("loadShortSubtitles")(function* (
  clips: readonly { id: string; text: string; durationSeconds: number }[],
  fps: number
) {
  const clipOps = yield* ClipOperationsService;
  const withWords = yield* Effect.forEach(clips, (clip) =>
    clipOps
      .listTranscriptWords(clip.id)
      .pipe(Effect.map((words) => ({ ...clip, words })))
  );
  return shortSubtitles(withWords, fps);
});
