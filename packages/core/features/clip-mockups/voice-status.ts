/**
 * Where a Clip Mockup's voice stands — the synthesised speech for its line.
 * Stored on the Clip Mockup (`clip_mockup.voice_status`, held to these values
 * by a CHECK):
 *
 * - `pending` — the line is written but its voice has not been made yet. The
 *   Clip Mockup has no `audioPath` and no `durationSeconds`.
 * - `ready` — the voice is on disk: `audioPath` and `durationSeconds` are set.
 * - `failed` — making the voice did not finish; `voiceError` says why.
 *
 * `cvm clip-mockup add` and `update` write a new line `pending` and queue a
 * `clip-mockup-voice` Job (`CLIP_MOCKUP_VOICE_JOB_KIND`), which the Sidecar
 * runs: it makes the voice and sets `ready`, or `failed` once its attempts are
 * spent. Until then the line's run time is a guess from its words
 * (`estimate-spoken-seconds.ts`).
 */
export const CLIP_MOCKUP_VOICE_STATUSES = [
  "pending",
  "ready",
  "failed",
] as const;

export type ClipMockupVoiceStatus = (typeof CLIP_MOCKUP_VOICE_STATUSES)[number];

/** The kind of the Job that makes a Clip Mockup's voice (`sidecar/kinds/clip-mockup-voice.ts`). */
export const CLIP_MOCKUP_VOICE_JOB_KIND = "clip-mockup-voice";
