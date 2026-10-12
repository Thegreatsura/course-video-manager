/**
 * A CLAP IN THE MIC: a sharp transient. The level jumps by more than
 * `ONSET_RISE_DB` within `ONSET_RISE_MS` of a quiet stretch, and falls at
 * least `DECAY_DB` from its peak within `DECAY_MS`. Its time is the first
 * sample of the rise that reaches a tenth of the peak: sub-millisecond.
 */

/** How far the level must jump over the quiet before it, in dB. */
export const ONSET_RISE_DB = 30;
/** How quickly the jump must happen, in ms. */
export const ONSET_RISE_MS = 5;
/** The quiet stretch the jump is measured from, in ms (ending at the rise). */
const QUIET_MS = 20;
/** Within this long after the onset, in ms, a clap has died away... */
export const DECAY_MS = 100;
/** ...by at least this much under its peak, in dB. */
export const DECAY_DB = 15;
/** After a clap, its own tail and echoes are not new claps for this long, in ms. */
const REFRACTORY_MS = 300;
/** The onset sample: the first to reach this fraction of the peak (-20 dB). */
const ONSET_FRACTION = 0.1;

const toDb = (amplitude: number) => 20 * Math.log10(Math.max(amplitude, 1e-7));

/**
 * The onset of every clap in `samples` (mono), in seconds of the file:
 * `startSeconds` is the file time of the first sample.
 */
export const findAudioOnsets = (
  samples: Float32Array,
  sampleRate: number,
  startSeconds: number
): number[] => {
  const block = Math.max(1, Math.round(sampleRate / 1000));
  const blocks = Math.floor(samples.length / block);
  const peak = new Float32Array(blocks);
  for (let b = 0; b < blocks; b++) {
    let p = 0;
    for (let i = b * block; i < (b + 1) * block; i++)
      p = Math.max(p, Math.abs(samples[i]!));
    peak[b] = p;
  }
  const maxOver = (from: number, to: number) => {
    let p = 0;
    for (let b = Math.max(0, from); b < Math.min(blocks, to); b++)
      p = Math.max(p, peak[b]!);
    return p;
  };

  const onsets: number[] = [];
  let b = QUIET_MS;
  while (b < blocks - DECAY_MS - ONSET_RISE_MS) {
    const quietDb = toDb(maxOver(b - QUIET_MS, b));
    const risePeak = maxOver(b, b + ONSET_RISE_MS);
    if (toDb(risePeak) - quietDb < ONSET_RISE_DB) {
      b++;
      continue;
    }
    const after = maxOver(b + DECAY_MS, b + DECAY_MS + ONSET_RISE_MS * 2);
    if (toDb(risePeak) - toDb(after) < DECAY_DB) {
      b++;
      continue;
    }
    let first = b * block;
    while (Math.abs(samples[first]!) < risePeak * ONSET_FRACTION) first++;
    onsets.push(startSeconds + first / sampleRate);
    b += REFRACTORY_MS;
  }
  return onsets;
};
