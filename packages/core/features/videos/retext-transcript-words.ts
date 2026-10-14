/**
 * A Clip's **Transcript Words** after its text is edited by hand (#2184).
 *
 * The words must never disagree with the text, but an edit carries no timing
 * of its own, so the new words borrow the old ones':
 *
 *   - The SAME number of words: each new word takes the times of the old word
 *     in its place. That is the common case (a misheard word fixed), and it
 *     keeps every timing exact.
 *   - A DIFFERENT number: the new words share out the span the old ones
 *     covered (first start to last end) by letter count, the same fallback a
 *     Short's subtitles use for a Clip with no words (#2174).
 *   - No old words (a Clip transcribed before they existed): it stays with
 *     none, which is a normal state, rather than inventing timings.
 *   - Empty text: no words.
 *
 * Pure: the transaction that writes the result is in
 * db-clip-operations.server.ts.
 */

/** One spoken word, Clip-relative seconds. */
export interface RetextWord {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

/** Only letters and digits weigh, so punctuation doesn't stretch a word. A word with none still gets a sliver. */
const weightOf = (word: string) =>
  Math.max(word.match(/[\p{L}\p{N}]/gu)?.length ?? 0, 1);

export const retextTranscriptWords = (
  text: string,
  oldWords: ReadonlyArray<RetextWord>
): RetextWord[] => {
  const newWords = text.split(/\s+/).filter((word) => word.length > 0);
  if (newWords.length === 0 || oldWords.length === 0) return [];

  const ordered = [...oldWords].sort(
    (a, b) => a.start - b.start || a.end - b.end
  );

  if (newWords.length === ordered.length) {
    return newWords.map((word, index) => ({
      start: ordered[index]!.start,
      end: ordered[index]!.end,
      text: word,
    }));
  }

  const spanStart = ordered[0]!.start;
  const spanEnd = Math.max(...ordered.map((word) => word.end));
  const span = Math.max(spanEnd - spanStart, 0);
  const totalWeight = newWords.reduce((sum, word) => sum + weightOf(word), 0);

  let weightBefore = 0;
  return newWords.map((word) => {
    const start = spanStart + (span * weightBefore) / totalWeight;
    weightBefore += weightOf(word);
    const end = spanStart + (span * weightBefore) / totalWeight;
    return { start, end, text: word };
  });
};
