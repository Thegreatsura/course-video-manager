/**
 * The one definition of silence (ADR 0034 §5), read by every silence detector:
 * ffmpeg's silencedetect on OBS files and in the CVM recorder's camera+mic
 * process, and the browser's detector on the OBS path (`silence-scan.ts`), which
 * measures exactly as silencedetect does. Change a value here and all of them
 * move together.
 */

/**
 * The fixed noise level, in dBFS, as silencedetect's `n`: a sample is silent
 * when its absolute amplitude is below it. A sample peak, not an RMS level.
 *
 * Only for work that is not recording: chunking or re-cutting old Footage,
 * and the OBS browser detector's level before any AV Calibration has
 * passed (nothing records then: ADR 0038). A Recording Session cuts with the
 * threshold of the AV Calibration it started under, read once when it
 * starts (`SilenceThreshold`).
 */
export const DEFAULT_SILENCE_THRESHOLD_DB = -38;

/**
 * The threshold a Recording Session cuts with, and the AV Calibration that
 * set it: the latest passed one when recording started, or null (and
 * `DEFAULT_SILENCE_THRESHOLD_DB`) when none has passed yet.
 */
export type SilenceThreshold = {
  readonly thresholdDb: number;
  readonly avCalibrationId: string | null;
};

/** No AV Calibration has passed: the fixed default. */
export const UNCALIBRATED_SILENCE_THRESHOLD: SilenceThreshold = {
  thresholdDb: DEFAULT_SILENCE_THRESHOLD_DB,
  avCalibrationId: null,
};

/** Minimum clip length (in seconds) — clips shorter than this are discarded */
export const MINIMUM_CLIP_LENGTH_SECONDS = 1;

/**
 * Seconds of room left at the end of an auto-edited Clip, so a cut does not
 * land on the last syllable.
 *
 * Here rather than in `silence-detection.ts`, its original home, because it has
 * a SECOND consumer that must not drift from it: the gap an Animatic holds
 * between Clip Mockups (`CLIP_MOCKUP_GAP_SECONDS`), so a mock paces like the
 * filmed Lesson will. That consumer is client code and this module — unlike
 * `silence-detection.ts` — pulls in no ffmpeg.
 */
export const AUTO_EDITED_END_PADDING_SECONDS = 0.08;

/**
 * Per-Recording-Session "Silence Length" mode (see GLOSSARY.md).
 * Controls how long a silence must last before it ends a clip.
 * Applied symmetrically to the frontend speech detector and the backend
 * FFmpeg silence detection.
 */
export type SilenceLength = "short" | "long";

export const SILENCE_LENGTH_SHORT_SECONDS = 0.8;
export const SILENCE_LENGTH_LONG_SECONDS = 2.0;

export const DEFAULT_SILENCE_LENGTH: SilenceLength = "short";

export const silenceLengthToSeconds = (silenceLength: SilenceLength): number =>
  silenceLength === "short"
    ? SILENCE_LENGTH_SHORT_SECONDS
    : SILENCE_LENGTH_LONG_SECONDS;

/**
 * What counts as silence for one Recording Session: every channel's samples
 * below its threshold for at least the Silence Length.
 */
export type SilenceRule = {
  readonly thresholdDb: number;
  readonly minSilenceSeconds: number;
};

export const silenceRule = (
  silenceLength: SilenceLength,
  thresholdDb: number
): SilenceRule => ({
  thresholdDb,
  minSilenceSeconds: silenceLengthToSeconds(silenceLength),
});

/** The rule as ffmpeg's filter (mono=0: every channel must be silent). */
export const silencedetectFilter = (rule: SilenceRule): string =>
  `silencedetect=n=${rule.thresholdDb}dB:d=${rule.minSilenceSeconds}`;

/** The noise level as a linear amplitude, the value silencedetect compares samples with. */
export const silenceThresholdAmplitude = (rule: SilenceRule): number =>
  10 ** (rule.thresholdDb / 20);
