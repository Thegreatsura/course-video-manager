/**
 * How much text a subtitle shows at one time.
 *
 * Shared by the vertical Shorts renderer (`render-vertical-video-service.ts`,
 * which burns the subtitles into the file) and the Animatic (which draws them
 * over its Clip Mockups while it plays). Pure, and free of ffmpeg and Effect,
 * so the browser can import it. The two consumers draw the text differently;
 * what they share is the rule that cuts it into phrases. The Animatic's
 * landscape frame takes a longer limit than the Short's narrow one.
 */

/** A span of text timed in seconds. */
export type SubtitleSegment = { start: number; end: number; text: string };

/**
 * The longest a single on-screen subtitle may be before it is split into
 * multiple phrases. Ported verbatim from the original Total TypeScript renderer.
 */
export const MAXIMUM_SUBTITLE_LENGTH_IN_CHARS = 32;

/**
 * Split a segment that is longer than {@link MAXIMUM_SUBTITLE_LENGTH_IN_CHARS}
 * into several shorter phrases, distributing the words evenly and dividing the
 * segment's time span evenly across the resulting chunks. A caller with a
 * wider frame than a Short may pass a longer limit.
 *
 * Ported verbatim from the original Total TypeScript renderer's
 * `splitSubtitleSegments`. Timing is by even division (not per-word
 * timestamps), which is the behaviour we are intentionally reproducing.
 */
export function splitSubtitleSegments(
  subtitle: SubtitleSegment,
  maximumLengthInChars: number = MAXIMUM_SUBTITLE_LENGTH_IN_CHARS
): SubtitleSegment[] {
  if (subtitle.text.length <= maximumLengthInChars) {
    return [subtitle];
  }

  const numChunks = Math.ceil(subtitle.text.length / maximumLengthInChars);

  const words = subtitle.text.split(" ");
  const wordsPerChunk = Math.ceil(words.length / numChunks);

  const chunks: SubtitleSegment[] = [];
  const duration = subtitle.end - subtitle.start;
  const chunkDuration = duration / numChunks;

  for (let i = 0; i < numChunks; i++) {
    const startTime = subtitle.start + i * chunkDuration;
    const endTime = startTime + chunkDuration;

    const startWordIndex = i * wordsPerChunk;
    const endWordIndex = startWordIndex + wordsPerChunk;

    chunks.push({
      start: startTime,
      end: endTime,
      text: words.slice(startWordIndex, endWordIndex).join(" ").trim(),
    });
  }

  return chunks;
}
