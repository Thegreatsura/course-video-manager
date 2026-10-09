/**
 * How long a Clip Mockup's line will take to say, guessed from its words,
 * for a Clip Mockup whose voice is not `ready` yet (`voice-status.ts`).
 *
 * The voice is made in the background, so a fresh line has no measured
 * duration. Its run time still matters at once: the authoring agent sums a
 * Video's durations to report the Animatic's length, and the timeline has to
 * hold the picture for some time. This is that guess, and ONLY that: the
 * measured length of the voice replaces it as soon as the voice is ready.
 *
 * Pure, and the one place the guess is made — the CLI's output and the
 * Animatic's timeline both use it, so the two never disagree.
 *
 * The rate is fitted to Clip Mockups already voiced by Kokoro (af_heart):
 * a fixed lead-in plus a fixed time per word — a least-squares fit over the
 * 5,088 voiced Clip Mockups in the database on 2026-10-09 (R² 0.80). Summed
 * over a Video, the errors of single lines largely cancel.
 */
export const ESTIMATED_SECONDS_PER_WORD = 0.337;

/** The part of every line's length that does not grow with its words. */
export const ESTIMATED_LEAD_SECONDS = 1.65;

/** A line's words: runs of non-space characters. */
export const countSpokenWords = (line: string): number =>
  line.split(/\s+/).filter((word) => word !== "").length;

/** Seconds a line is expected to run once voiced; 0 for a line with no words. */
export const estimateSpokenSeconds = (line: string): number => {
  const words = countSpokenWords(line);
  if (words === 0) return 0;
  return (
    Math.round(
      (ESTIMATED_LEAD_SECONDS + words * ESTIMATED_SECONDS_PER_WORD) * 100
    ) / 100
  );
};
