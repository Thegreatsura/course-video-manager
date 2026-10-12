/**
 * A CLAP IN THE MIC: a sharp transient. The level jumps by more than
 * `ONSET_RISE_DB` within `ONSET_RISE_MS` of a quiet stretch, and falls at
 * least `DECAY_DB` from its peak within `DECAY_MS`. Its time is the first
 * sample of the rise that reaches a tenth of the peak: sub-millisecond. A
 * transient far quieter than the loudest one (`QUIETER_THAN_LOUDEST_DB`) is
 * a rustle, not a clap.
 */

/**
 * How far the level must jump over the quiet before it, in dB. Real claps
 * rose 20.6-47.5 dB on 2026-10-12's four calibrations; 30 lost most of them.
 */
export const ONSET_RISE_DB = 20;
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
/**
 * A transient peaking this far under the loudest in the window is not a
 * clap: a soft clap came 32 dB under the loudest, a rustle after the last
 * clap 46 dB under (2026-10-12).
 */
const QUIETER_THAN_LOUDEST_DB = 40;
/** The window over which a clap's peak is read, in ms from its rise. */
const PEAK_MS = 10;

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

  const onsets: { seconds: number; peakDb: number }[] = [];
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
    onsets.push({
      seconds: startSeconds + first / sampleRate,
      peakDb: toDb(maxOver(b, b + PEAK_MS)),
    });
    b += REFRACTORY_MS;
  }
  const loudestDb = Math.max(...onsets.map((o) => o.peakDb));
  return onsets
    .filter((o) => o.peakDb >= loudestDb - QUIETER_THAN_LOUDEST_DB)
    .map((o) => o.seconds);
};

/**
 * A START-UP GAP in the mic: a run of exact digital silence soon after its
 * first sound. When ffmpeg stalls reading the mic just after it starts, it
 * reads the backlog late and `aresample=async` pads the hole with silence,
 * leaving the mic's timing 0-100 ms out: a Mic Offset measured over it
 * cannot be trusted (#2120). A real mic is never exactly silent; the
 * silence before its first sound is the capture's own start, not a gap.
 */
export type StartUpGap = {
  /** Where the gap starts, in seconds of the file. */
  atSeconds: number;
  /** How long it lasts, in ms. */
  ms: number;
};

/** A gap starts within this long of the mic's first sound, in s... */
const START_UP_S = 2;
/** ...and lasts at least this long, in ms (the ones seen ran 73-423 ms). */
const MIN_GAP_MS = 20;

/**
 * The first start-up gap in `samples` (mono, from the file's start), or
 * null when the mic ran unbroken.
 */
export const findStartUpGap = (
  samples: Float32Array,
  sampleRate: number
): StartUpGap | null => {
  const first = samples.findIndex((x) => x !== 0);
  if (first < 0) return null;
  const end = Math.min(samples.length, first + START_UP_S * sampleRate);
  const minRun = (MIN_GAP_MS / 1000) * sampleRate;
  let i = first;
  while (i < end) {
    if (samples[i] !== 0) {
      i++;
      continue;
    }
    let run = i;
    while (run < samples.length && samples[run] === 0) run++;
    // Silence to the end of the file is the capture stopping, not a gap.
    if (run - i >= minRun && run < samples.length)
      return { atSeconds: i / sampleRate, ms: ((run - i) / sampleRate) * 1000 };
    i = run;
  }
  return null;
};
