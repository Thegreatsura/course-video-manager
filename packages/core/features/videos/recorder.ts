/**
 * The Recorder a Video is filmed with, chosen per Video (`video.recorder`):
 *
 * - `obs` — OBS records one file with the scene baked in, and the editor makes
 *   Clips from it as it always has.
 * - `new-recorder` — CVM's own recorder writes a Recording Session: camera,
 *   screen and mic as three Footage files plus a scene timeline, so the
 *   picture is drawn at export and a Clip can carry a Scene Override.
 *
 * Every Video filmed before the choice existed has a null column, which reads
 * as OBS.
 */
export const VIDEO_RECORDERS = ["obs", "new-recorder"] as const;

export type VideoRecorder = (typeof VIDEO_RECORDERS)[number];

export const DEFAULT_VIDEO_RECORDER: VideoRecorder = "obs";

/** Read `video.recorder`: null (or anything unknown) is OBS. */
export function resolveVideoRecorder(
  recorder: string | null | undefined
): VideoRecorder {
  return (VIDEO_RECORDERS as readonly string[]).includes(recorder ?? "")
    ? (recorder as VideoRecorder)
    : DEFAULT_VIDEO_RECORDER;
}

/**
 * Where a Recording Session stands (`recording_session.status`):
 * `recording` while the recorder is writing its files, `stopped` once it
 * finished them cleanly, `crashed` when the recorder found it still
 * `recording` after a restart.
 */
export const RECORDING_SESSION_STATUSES = [
  "recording",
  "stopped",
  "crashed",
] as const;

export type RecordingSessionStatus =
  (typeof RECORDING_SESSION_STATUSES)[number];

/**
 * The scenes a Recording Session's picture can be drawn in. A scene event
 * records which one was live from a moment in the Footage on; a Clip's Scene
 * Override replaces them for that Clip alone.
 */
export const RECORDING_SESSION_SCENES = ["Camera", "Code", "No Face"] as const;

export type RecordingSessionScene = (typeof RECORDING_SESSION_SCENES)[number];

/**
 * The mic offset a new Recording Session gets, in ms: the mic's sound is
 * shifted later by this much at export. 150 ms matches the sync offset OBS
 * applies to the same mic, which the new recorder's raw files do not carry.
 */
export const DEFAULT_MIC_OFFSET_MS = 150;

/**
 * The range a Recording Session's mic offset may be set to, in ms. Lip sync
 * is corrected by a few hundred ms at most; anything past two seconds is a
 * typo, not a correction.
 */
export const MIC_OFFSET_MS_RANGE = { min: -2000, max: 2000 } as const;

/**
 * The mic EQ the export applies to a Recording Session's mic: the gains, in
 * dB, of OBS's 3-Band Equalizer filter (bands split at 800 Hz and 5 kHz), the
 * filter OBS runs on the same mic. Raw Footage is never changed.
 */
export type MicEq = {
  readonly lowDb: number;
  readonly midDb: number;
  readonly highDb: number;
};

/** Matt's OBS mic EQ: highs down 6.1 dB, low and mid flat. */
export const DEFAULT_MIC_EQ: MicEq = { lowDb: 0, midDb: 0, highDb: -6.1 };

/**
 * The one saved Mic EQ Setting every Recording Session is exported with
 * (`recording_session.mic_eq_setting_id`). Saving it re-EQs every
 * New-recorder Video; until it is first saved the mic reads as
 * {@link DEFAULT_MIC_EQ}.
 */
export const MIC_EQ_SETTING_ID = "default";

/** The gain each band of the mic EQ may be set to, in dB. */
export const MIC_EQ_DB_RANGE = { min: -24, max: 24 } as const;

/**
 * The Recorders a Video of this format may record with. Shorts record with
 * OBS only: the New recorder cannot film the Spacedesk display yet.
 */
export function recordersForFormat(format: string): readonly VideoRecorder[] {
  return format === "short" ? ["obs"] : VIDEO_RECORDERS;
}

/**
 * The `video.recorder` a new Video is stored with: the Recorder it was
 * created with (the editor's last choice), or null (OBS) when none was given
 * or the format cannot record with it.
 */
export function recorderForNewVideo(
  format: string,
  recorder: VideoRecorder | null | undefined
): VideoRecorder | null {
  if (!recorder) return null;
  return recordersForFormat(format).includes(recorder) ? recorder : null;
}
