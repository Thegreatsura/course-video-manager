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
 * Today every write voices the line before it saves the row, so every Clip
 * Mockup is `ready`. `pending` and `failed` exist for voicing in the
 * background (migration 0030).
 */
export const CLIP_MOCKUP_VOICE_STATUSES = [
  "pending",
  "ready",
  "failed",
] as const;

export type ClipMockupVoiceStatus = (typeof CLIP_MOCKUP_VOICE_STATUSES)[number];
