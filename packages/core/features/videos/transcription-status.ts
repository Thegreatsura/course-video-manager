/**
 * Where a Clip's Transcription stands. Stored on the Clip
 * (`clip.transcription_status`, held to these values by a CHECK) and written
 * at every transition:
 *
 * - `queued` — the Clip was recorded and has no text yet; a Transcription has
 *   been asked for but has not started.
 * - `transcribing` — a Transcription is running.
 * - `failed` — the last Transcription did not finish. The Clip keeps whatever
 *   text and Transcript Words it had before; transcribing it again is the fix.
 * - `done` — the last Transcription finished. Its text may be empty: nothing
 *   was said.
 *
 * A Clip that gets its text some other way (an Effect Clip, a Clip cut from
 * Footage whose transcript already exists) starts `done`.
 */
export const TRANSCRIPTION_STATUSES = [
  "queued",
  "transcribing",
  "failed",
  "done",
] as const;

export type TranscriptionStatus = (typeof TRANSCRIPTION_STATUSES)[number];

/** A Transcription is on its way: queued or running. */
export const isTranscriptionPending = (status: TranscriptionStatus): boolean =>
  status === "queued" || status === "transcribing";
