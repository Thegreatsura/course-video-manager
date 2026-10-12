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

/** The Recorder a Clip was filmed with: a Recording Session means the New recorder. */
export function clipRecorder(clip: {
  readonly recordingSessionId: string | null;
}): VideoRecorder {
  return clip.recordingSessionId !== null ? "new-recorder" : "obs";
}

/**
 * Why an archived Clip may not be restored onto its Video, or null when it
 * may. Archiving every Clip unlocks the Video's Recorder; once it has
 * switched, restoring a Clip filmed with the other Recorder would mix OBS
 * and new-recorder Clips on one Video, so it is refused.
 */
export function clipRestoreRefusal(
  videoRecorder: string | null,
  clip: { readonly recordingSessionId: string | null }
): string | null {
  const video = resolveVideoRecorder(videoRecorder);
  const filmed = clipRecorder(clip);
  if (video === filmed) return null;
  const label = (r: VideoRecorder) =>
    r === "obs" ? "OBS" : "the New recorder";
  return `This Clip was filmed with ${label(filmed)}, but the Video now records with ${label(video)}. Switch the Recorder back to restore it.`;
}

/**
 * Whether an error message is a `clipRestoreRefusal`, as the server sends it
 * back: the editor rolls a refused restore back and shows why, rather than
 * treating it as a fatal error.
 */
export function isClipRestoreRefusal(message: string): boolean {
  return (["obs", "new-recorder"] as const).some(
    (videoRecorder) =>
      message ===
      clipRestoreRefusal(videoRecorder, {
        recordingSessionId: videoRecorder === "obs" ? "session" : null,
      })
  );
}

/**
 * Why Export to DaVinci Resolve refuses this Video, or null when it may run.
 * The export hands DaVinci one Footage file per Clip, so it stays OBS-only: a
 * new-recorder Clip's picture is a composite of three files (#2011; Matt
 * never uses this export). The editor hides it on a New recorder Video; this
 * also covers an OBS Video a new-recorder Clip was moved or copied onto.
 */
export function davinciResolveRefusal(video: {
  readonly recorder: string | null;
  readonly clips: readonly { readonly recordingSessionId: string | null }[];
}): string | null {
  const only = "Export to DaVinci Resolve works on OBS Videos only";
  if (resolveVideoRecorder(video.recorder) !== "obs") {
    return `${only}: this Video records with the New recorder.`;
  }
  if (video.clips.some((clip) => clip.recordingSessionId !== null)) {
    return `${only}: this Video holds new-recorder Clips.`;
  }
  return null;
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
