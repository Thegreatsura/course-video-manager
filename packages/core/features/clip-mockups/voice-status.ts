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

/**
 * The Job Event a `clip-mockup-voice` run appends once it has read its rows:
 * `{ lines: { [clipMockupId]: line } }`, the words it is voicing now. A
 * request for the same words is covered by it (`voice-job-cover.ts`).
 */
export const CLIP_MOCKUP_VOICING_EVENT = "voicing";

/**
 * A Clip Mockup's voice as a COPY of it carries it (a Version's Submit, a
 * Course's duplicate, a Video's copy). The copy is a new row no voice Job
 * names: a `ready` voice comes with its WAV; any other comes `pending`, and
 * the Sidecar's sweep (`sidecar/clip-mockup-voice-sweep.ts`) queues a Job
 * for it.
 */
export const copiedVoice = (row: {
  readonly audioPath: string | null;
  readonly durationSeconds: number | null;
  readonly voiceStatus: ClipMockupVoiceStatus;
}) =>
  row.voiceStatus === "ready"
    ? {
        audioPath: row.audioPath,
        durationSeconds: row.durationSeconds,
        voiceStatus: "ready" as const,
        voiceError: null,
      }
    : {
        audioPath: null,
        durationSeconds: null,
        voiceStatus: "pending" as const,
        voiceError: null,
      };
