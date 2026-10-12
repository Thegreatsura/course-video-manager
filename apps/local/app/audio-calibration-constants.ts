/**
 * THE NUMBERS of an Audio Calibration (#2077, "The numbers"), beside the one
 * definition of silence (`silence-detection-constants.ts`) whose threshold an
 * Audio Calibration will set. Every number the Audio Calibration page and its
 * judgement use lives here, as a named constant.
 */

/** The speech loudness Matt sets his mic to, in LUFS: his level before it drifted. */
export const TARGET_LOUDNESS_LUFS = -21;

/** How far either side of the target still passes, in dB. */
export const TARGET_TOLERANCE_DB = 2;

/** The target band, inclusive at both ends: -23 to -19 LUFS. */
export const TARGET_BAND = {
  lowLufs: TARGET_LOUDNESS_LUFS - TARGET_TOLERANCE_DB,
  highLufs: TARGET_LOUDNESS_LUFS + TARGET_TOLERANCE_DB,
} as const;

/** Where a loudness sits against the target band, and by how many dB. */
export type BandPosition =
  /** `byDb`: how far below the band's low edge. */
  | { position: "below"; byDb: number }
  /** `byDb`: from the target, negative under it. */
  | { position: "inside"; byDb: number }
  /** `byDb`: how far above the band's high edge. */
  | { position: "above"; byDb: number };

export const bandPosition = (lufs: number): BandPosition => {
  if (lufs < TARGET_BAND.lowLufs)
    return { position: "below", byDb: TARGET_BAND.lowLufs - lufs };
  if (lufs > TARGET_BAND.highLufs)
    return { position: "above", byDb: lufs - TARGET_BAND.highLufs };
  return { position: "inside", byDb: lufs - TARGET_LOUDNESS_LUFS };
};
