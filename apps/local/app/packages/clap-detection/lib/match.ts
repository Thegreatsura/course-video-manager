/**
 * THE MATCHER: pure, over what the two ffmpeg passes decoded. It is led by
 * the mic: each mic onset is a clap heard, and its contact is looked for in
 * the camera's motion series (the mean of each frame's difference from the
 * one before) only in a short window around it, against the motion near it.
 * One threshold for the whole clap window, raised by Matt moving between
 * claps, rejected every clap of a calibration (2026-10-12). The contact is
 * the motion peak just before the motion collapses, as the hands stop. The
 * Mic Offset is the median of (video - audio).
 */

/** One frame's motion: the mean of its difference from the frame before. */
export type MotionPoint = { seconds: number; level: number };

/** A clap found in both files, in seconds of each (one shared clock). */
export type Clap = { audioS: number; videoS: number; offsetMs: number };

export type ClapMatch = {
  claps: Clap[];
  /** How many claps were found in both the mic and the camera. */
  found: number;
  /** Max - min of the paired offsets, in ms; null with no pair. */
  spreadMs: number | null;
  /** median(video - audio), in ms; null with no pair. */
  micOffsetMs: number | null;
};

/**
 * How far a clap's contact may be from its mic onset, in s, either way:
 * over three times the largest Mic Offset seen (-92 ms), and a fifth of the
 * ~1.5 s between prompted claps, so a neighbouring clap's contact, or the
 * hands parting after this one, never stands in for it.
 */
export const CONTACT_WINDOW_S = 0.3;
/**
 * A burst's peak comes before its contact: up to this long before, in s
 * (the hands close over about a quarter of a second).
 */
const BURST_LEAD_S = 0.25;
/**
 * The motion near a clap, read this far either side of it in s, gives the
 * level the hands' burst stands over: its lower quartile, since the clap's
 * own closing and parting take up about half of it.
 */
const NEAR_S = 0.75;
const STILL_QUANTILE = 0.25;
/** A burst's frames stand this far toward its peak over the motion near it... */
const PEAK_OF_MAX = 0.3;
/** ...and the peak at least this far over it (YAVG, 0-255). */
const PEAK_MIN_LEVEL = 0.3;
/**
 * A burst's last frame near its peak: the last at this share of the peak or
 * more. The hands stop in it or in the frame after.
 */
const LAST_FRAME_OF_PEAK = 0.8;

/** The `q` quantile of `xs` (0: the least; 1: the most), nearest rank. */
const quantile = (xs: readonly number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))]!;
};

const median = (xs: readonly number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
};

type Contact = { seconds: number; peak: number; lastFrame: number };

/**
 * The contact of the clap heard at `onsetS`, or null when the camera saw no
 * burst of motion for it. The hands move fastest just before they meet and
 * stop dead when they do, so a clap is a burst of motion that collapses. A
 * frame's motion is the movement since the frame before; at the peak's
 * speed, a frame the hands stopped in sees the share of a full frame's
 * motion they still moved for. So the contact is read off the burst's tail
 * in frames of peak motion: interpolated between the frames either side of
 * the collapse. Of the bursts whose contact is within `CONTACT_WINDOW_S`,
 * the biggest is the clap.
 */
const findContact = (
  motion: readonly MotionPoint[],
  frameS: number,
  onsetS: number
): Contact | null => {
  const levels = motion.map((m) => m.level);
  const near = motion
    .filter((m) => Math.abs(m.seconds - onsetS) <= NEAR_S)
    .map((m) => m.level);
  if (near.length === 0) return null;
  const base = quantile(near, STILL_QUANTILE);
  const from = motion.findIndex(
    (m) => m.seconds >= onsetS - CONTACT_WINDOW_S - BURST_LEAD_S
  );
  if (from < 0) return null;
  let to = from;
  while (
    to + 1 < motion.length &&
    motion[to + 1]!.seconds <= onsetS + CONTACT_WINDOW_S
  )
    to++;
  const max = Math.max(...levels.slice(from, to + 1));
  if (max - base < PEAK_MIN_LEVEL) return null;
  const threshold = base + Math.max(PEAK_OF_MAX * (max - base), PEAK_MIN_LEVEL);
  const moved = (k: number) => Math.max((levels[k] ?? base) - base, 0);

  let best: Contact | null = null;
  for (let i = from; i <= to; i++) {
    if (levels[i]! < threshold) continue;
    // A burst: a run of frames over the threshold.
    let end = i;
    while (end + 1 < motion.length && levels[end + 1]! >= threshold) end++;
    const peak = Math.max(...levels.slice(i, end + 1));
    let last = end;
    while (levels[last]! < LAST_FRAME_OF_PEAK * peak) last--;
    // The motion from the frame before `last` on, in full frames: one full
    // frame and the share of the next the hands still moved in. (If `last`
    // is itself the frame they stopped in, it is that share alone.)
    const frames = Math.min((moved(last) + moved(last + 1)) / (peak - base), 2);
    const seconds = motion[last]!.seconds + (frames - 1) * frameS;
    if (
      Math.abs(seconds - onsetS) <= CONTACT_WINDOW_S &&
      (!best || peak > best.peak)
    )
      best = { seconds, peak, lastFrame: last };
    i = end;
  }
  return best;
};

/**
 * The claps in a mic's onsets and a camera's motion series: each onset with
 * its contact (`findContact`). Two onsets that find the same contact (a
 * knock just after a clap) are one clap: the nearer onset's. An onset with
 * no contact (a transient the camera saw no clap for) is not a clap.
 */
export const matchClaps = (o: {
  onsetsS: readonly number[];
  motion: readonly MotionPoint[];
}): ClapMatch => {
  const frameS = median(
    o.motion.slice(1).map((m, i) => m.seconds - o.motion[i]!.seconds)
  );
  const byContact = new Map<number, Clap>();
  if (o.motion.length >= 3)
    for (const audioS of o.onsetsS) {
      const contact = findContact(o.motion, frameS, audioS);
      if (!contact) continue;
      const clap: Clap = {
        audioS,
        videoS: contact.seconds,
        offsetMs: (contact.seconds - audioS) * 1000,
      };
      const rival = byContact.get(contact.lastFrame);
      if (!rival || Math.abs(clap.offsetMs) < Math.abs(rival.offsetMs))
        byContact.set(contact.lastFrame, clap);
    }
  const claps = [...byContact.values()].sort((x, y) => x.audioS - y.audioS);
  const offsets = claps.map((c) => c.offsetMs);
  return {
    claps,
    found: claps.length,
    spreadMs: offsets.length
      ? Math.max(...offsets) - Math.min(...offsets)
      : null,
    micOffsetMs: offsets.length ? median(offsets) : null,
  };
};
