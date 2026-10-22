import { Effect } from "effect";
import {
  isListedClipMockupFile,
  listClipMockupFiles,
} from "./clip-mockup-files";
import { clipMockupSpeechOnsetSeconds } from "./clip-mockup-speech-onset.server";

/** The two files a Clip Mockup row names. */
export interface AnimaticFileRow {
  readonly imagePath: string;
  /** `null` while the voice is not made yet. */
  readonly audioPath: string | null;
}

/** What the Animatic page needs to know about one row's files. */
export interface AnimaticRowFiles {
  readonly imageMissing: boolean;
  /** The row names no WAV yet, or names one that is not on disk. */
  readonly audioMissing: boolean;
  /** Where the voice starts inside its WAV, past Kokoro's padding (#2265). */
  readonly speechStartSeconds: number;
}

/**
 * How many WAV heads are read at once on a cold cache. Bounded, because the
 * first load of a sixty-line Animatic would otherwise open sixty files on the
 * Storage Root together.
 */
const ONSET_CONCURRENCY = 8;

/**
 * Every row's files, checked against ONE listing of the Video's Clip Mockup
 * directory per Storage Root — not a realpath, exists and stat per file
 * (#2337). The Animatic loader is polled every two seconds, and on Matt's
 * drvfs roots the per-file checks of a sixty-line Animatic took longer than
 * the poll, so each poll was cut off by the next and the page never settled.
 *
 * The speech onset is cached per WAV for the life of the server
 * (`clipMockupSpeechOnsetSeconds`), so after the first load a poll reads no
 * file at all — two directory listings and nothing else.
 */
export const readAnimaticClipMockupFiles = (
  lineageId: string,
  rows: readonly AnimaticFileRow[]
) =>
  Effect.gen(function* () {
    const listing = yield* listClipMockupFiles(lineageId);
    return yield* Effect.forEach(
      rows,
      (row) =>
        Effect.gen(function* () {
          const imageMissing = !isListedClipMockupFile(listing, row.imagePath);
          const audioMissing =
            row.audioPath === null ||
            !isListedClipMockupFile(listing, row.audioPath);
          const speechStartSeconds =
            row.audioPath === null || audioMissing
              ? 0
              : yield* clipMockupSpeechOnsetSeconds(lineageId, row.audioPath);
          return {
            imageMissing,
            audioMissing,
            speechStartSeconds,
          } satisfies AnimaticRowFiles;
        }),
      { concurrency: ONSET_CONCURRENCY }
    );
  });
