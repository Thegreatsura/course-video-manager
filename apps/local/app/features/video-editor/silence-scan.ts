import {
  silenceThresholdAmplitude,
  type SilenceRule,
} from "@/silence-detection-constants";

/**
 * ffmpeg's silencedetect (mono=0), sample for sample, for audio that arrives
 * in blocks: the browser's silence detector on the OBS path, so it measures as
 * the CVM recorder's and the OBS files' detectors do (ADR 0034 §5).
 *
 * - A frame (one sample per channel) is silent when EVERY channel's sample is
 *   strictly inside ±the noise level. A peak test, not RMS.
 * - A silence starts once silent frames have run for the rule's minimum; it is
 *   dated from the first of them, as silencedetect's `silence_start` is.
 * - It ends at the first frame that is not silent (`silence_end`).
 *
 * Time is the audio's own: frames heard so far over the sample rate.
 */
export type SilenceScanEvent =
  | {
      type: "silence-started";
      /** Where the silence began (silencedetect's `silence_start`). */
      startSeconds: number;
      /** When it became long enough to count: now, as the block is heard. */
      heardAtSeconds: number;
    }
  | { type: "silence-ended"; endSeconds: number };

export type SilenceScanState = {
  /** Frames heard so far. */
  readonly frames: number;
  /** Silent frames in a row up to the last frame heard. */
  readonly quietFrames: number;
  readonly inSilence: boolean;
};

export const createSilenceScanState = (): SilenceScanState => ({
  frames: 0,
  quietFrames: 0,
  inSilence: false,
});

export const scanForSilence = (
  state: SilenceScanState,
  channels: readonly Float32Array[],
  rule: SilenceRule,
  sampleRate: number
): { state: SilenceScanState; events: SilenceScanEvent[] } => {
  const noise = silenceThresholdAmplitude(rule);
  const needed = Math.round(rule.minSilenceSeconds * sampleRate);
  const length = channels[0]?.length ?? 0;
  const events: SilenceScanEvent[] = [];
  let { frames, quietFrames, inSilence } = state;

  for (let i = 0; i < length; i++, frames++) {
    let silent = true;
    for (const channel of channels) {
      const x = channel[i]!;
      if (!(x < noise && x > -noise)) {
        silent = false;
        break;
      }
    }
    if (silent) {
      if (inSilence) continue;
      quietFrames++;
      if (quietFrames >= needed) {
        inSilence = true;
        events.push({
          type: "silence-started",
          startSeconds: (frames + 1 - quietFrames) / sampleRate,
          heardAtSeconds: (frames + 1) / sampleRate,
        });
      }
    } else {
      if (inSilence) {
        events.push({ type: "silence-ended", endSeconds: frames / sampleRate });
      }
      inSilence = false;
      quietFrames = 0;
    }
  }

  return { state: { frames, quietFrames, inSilence }, events };
};
