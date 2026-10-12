/**
 * A Recorder: what films a Clip.
 *
 * - `obs` — OBS records one file with the scene baked in, and the editor makes
 *   Clips from it as it always has.
 * - `cvm` — CVM's own recorder writes a Recording Session: camera,
 *   screen and mic as three Footage files plus a scene timeline, so the
 *   picture is drawn at export and a Clip can carry a Scene Override.
 *
 * A Recorder belongs to each Clip (`clipRecorder`), so one Video may hold
 * both. The Video's Recorder (`video.recorder`) only says which Recorder
 * opens next in the editor; it can be switched at any time except while
 * capturing (ADR 0036). A null column reads as the format's default: OBS for
 * a Landscape Video, the CVM recorder for a Short.
 */
export const VIDEO_RECORDERS = ["obs", "cvm"] as const;

export type VideoRecorder = (typeof VIDEO_RECORDERS)[number];

/**
 * The CVM recorder's old stored value, from when it was called the "New
 * recorder" (#1993). Migration 0033 rewrites it to `cvm`; until every
 * database and browser has caught up, it is still read as the CVM recorder.
 */
export const LEGACY_CVM_RECORDER_VALUE = "new-recorder";

/**
 * A stored Recorder (`video.recorder`, a remembered choice) as a
 * {@link VideoRecorder}, or null when it names none. The legacy
 * `new-recorder` reads as `cvm`.
 */
export function parseVideoRecorder(
  recorder: string | null | undefined
): VideoRecorder | null {
  if (recorder === LEGACY_CVM_RECORDER_VALUE) return "cvm";
  return (VIDEO_RECORDERS as readonly string[]).includes(recorder ?? "")
    ? (recorder as VideoRecorder)
    : null;
}

/**
 * The Recorder a Video opens next (`video.recorder`), read for its format: a
 * stored Recorder the format may record with, else the format's default (the
 * first of `recordersForFormat`) — OBS for a Landscape Video, the CVM recorder
 * for a Short, whatever a Short stored before Shorts went CVM-only.
 */
export function resolveVideoRecorder(video: {
  readonly format: string;
  readonly recorder: string | null | undefined;
}): VideoRecorder {
  const options = recordersForFormat(video.format);
  const parsed = parseVideoRecorder(video.recorder);
  return parsed && options.includes(parsed) ? parsed : options[0]!;
}

/** The Recorder a Clip was filmed with: a Recording Session means the CVM recorder. */
export function clipRecorder(clip: {
  readonly recordingSessionId: string | null;
}): VideoRecorder {
  return clip.recordingSessionId !== null ? "cvm" : "obs";
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
 * applies to the same mic, which the CVM recorder's raw files do not carry.
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
 * CVM-recorder Video; until it is first saved the mic reads as
 * {@link DEFAULT_MIC_EQ}.
 */
export const MIC_EQ_SETTING_ID = "default";

/** The gain each band of the mic EQ may be set to, in dB. */
export const MIC_EQ_DB_RANGE = { min: -24, max: 24 } as const;

const SHORT_RECORDERS: readonly VideoRecorder[] = ["cvm"];

/**
 * The Recorders a Video of this format may open next, its default first. A
 * Landscape Video may record with either and defaults to OBS. A Short records
 * with the CVM recorder only, filming the Spacedesk display as its screen
 * (ADR 0037); OBS-filmed Short Clips still export, as every Clip exports by
 * its own Recorder.
 */
export function recordersForFormat(format: string): readonly VideoRecorder[] {
  return format === "short" ? SHORT_RECORDERS : VIDEO_RECORDERS;
}

/**
 * The `video.recorder` a new Video is stored with: the Recorder it was
 * created with (the editor's last choice) when the format may record with
 * it; else the CVM recorder for a Short, or null (OBS) for a Landscape Video.
 */
export function recorderForNewVideo(
  format: string,
  recorder: VideoRecorder | null | undefined
): VideoRecorder | null {
  const options = recordersForFormat(format);
  if (recorder && options.includes(recorder)) return recorder;
  return options.length === 1 ? options[0]! : null;
}
