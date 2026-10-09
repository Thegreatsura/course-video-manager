/**
 * The `transcribe-footage` Job (`sidecar/kinds/transcribe-footage.ts`), as the
 * ones who listen to it know it: `cvm footage transcribe`, which enqueues it and
 * follows its Job Events, and the jobs reducer, which draws it no row and
 * never toasts it (the CLI is its audience, not the tab).
 */
export const TRANSCRIBE_FOOTAGE_JOB_KIND = "transcribe-footage";

export const FOOTAGE_TRANSCRIPTION_EVENTS = {
  /** One chunk settled: `{ key, index, count, start, end, cached }`. */
  chunkSettled: "chunk-settled",
  /**
   * The transcript is written: `{ path, sidecar, sourceHash, transcribedAt,
   * words, segments }` (counts), exactly what `cvm footage transcribe` prints.
   */
  transcribed: "footage-transcribed",
} as const;
