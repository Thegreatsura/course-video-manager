/**
 * THE MATCHER: pure, over what the two ffmpeg passes decoded. The camera's
 * motion series (the mean of each frame's difference from the one before)
 * gives each clap's contact: the motion peak just before the motion
 * collapses, as the hands stop. Each mic onset is paired with the nearest
 * contact, and the Mic Offset is the median of (video - audio).
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

/** A motion peak must stand this many MADs over the window's typical motion... */
const PEAK_MADS = 6;
/** ...and this far toward the window's biggest motion... */
const PEAK_OF_MAX = 0.3;
/** ...and at least this far over the typical motion (YAVG, 0-255). */
const PEAK_MIN_LEVEL = 0.3;
/**
 * A burst's last frame near its peak: the last at this share of the peak or
 * more. The hands stop in it or in the frame after.
 */
const LAST_FRAME_OF_PEAK = 0.8;
/** Two contacts closer than this, in s, are one clap: the larger burst wins. */
const CONTACT_SEPARATION_S = 0.5;
/**
 * The furthest a mic onset and a camera contact may be apart and still be
 * one clap, in s: under half the ~1.5 s between prompted claps.
 */
export const MAX_PAIR_DISTANCE_S = 0.6;

const median = (xs: readonly number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
};

/**
 * Each clap's contact in the motion series, in seconds. The hands move
 * fastest just before they meet and stop dead when they do, so a clap is a
 * burst of motion that collapses. A frame's motion is the movement since the
 * frame before; at the peak's speed, a frame the hands stopped in sees the
 * share of a full frame's motion they still moved for. So the contact is
 * read off the burst's tail in frames of peak motion: interpolated between
 * the frames either side of the collapse.
 */
export const findContacts = (motion: readonly MotionPoint[]): number[] => {
  if (motion.length < 3) return [];
  const levels = motion.map((m) => m.level);
  const base = median(levels);
  const mad = median(levels.map((l) => Math.abs(l - base)));
  const max = Math.max(...levels);
  const threshold =
    base +
    Math.max(PEAK_MADS * mad, PEAK_OF_MAX * (max - base), PEAK_MIN_LEVEL);
  const frameS = median(
    motion.slice(1).map((m, i) => m.seconds - motion[i]!.seconds)
  );

  // Each burst: a run of frames over the threshold.
  const bursts: { contactS: number; peak: number }[] = [];
  for (let i = 0; i < motion.length; i++) {
    if (levels[i]! < threshold) continue;
    let end = i;
    while (end + 1 < motion.length && levels[end + 1]! >= threshold) end++;
    const run = levels.slice(i, end + 1);
    const peak = Math.max(...run);
    let last = end;
    while (levels[last]! < LAST_FRAME_OF_PEAK * peak) last--;
    // The motion from the frame before `last` on, in full frames: one full
    // frame and the share of the next the hands still moved in. (If `last`
    // is itself the frame they stopped in, it is that share alone.)
    const moved = (k: number) => Math.max((levels[k] ?? base) - base, 0);
    const frames = Math.min((moved(last) + moved(last + 1)) / (peak - base), 2);
    const contactS = motion[last]!.seconds + (frames - 1) * frameS;
    bursts.push({ contactS, peak });
    i = end;
  }

  // Bursts closer than a clap apart (the hands parting after one) are one
  // clap: the bigger burst is its contact.
  const contacts: { contactS: number; peak: number }[] = [];
  for (const b of bursts) {
    const last = contacts.at(-1);
    if (last && b.contactS - last.contactS < CONTACT_SEPARATION_S) {
      if (b.peak > last.peak) contacts[contacts.length - 1] = b;
      continue;
    }
    contacts.push(b);
  }
  return contacts.map((c) => c.contactS);
};

/**
 * Pairs mic onsets with camera contacts, nearest pairs first, each used
 * once, none further apart than `MAX_PAIR_DISTANCE_S`. An onset left over (a
 * transient the camera did not see move) is not a clap; nor is a contact
 * left over (a movement with no sound).
 */
export const pairClaps = (
  onsetsS: readonly number[],
  contactsS: readonly number[]
): ClapMatch => {
  const candidates = onsetsS
    .flatMap((audioS, a) =>
      contactsS.map((videoS, v) => ({ a, v, audioS, videoS }))
    )
    .filter((c) => Math.abs(c.videoS - c.audioS) <= MAX_PAIR_DISTANCE_S)
    .sort(
      (x, y) => Math.abs(x.videoS - x.audioS) - Math.abs(y.videoS - y.audioS)
    );
  const usedA = new Set<number>();
  const usedV = new Set<number>();
  const claps: Clap[] = [];
  for (const c of candidates) {
    if (usedA.has(c.a) || usedV.has(c.v)) continue;
    usedA.add(c.a);
    usedV.add(c.v);
    claps.push({
      audioS: c.audioS,
      videoS: c.videoS,
      offsetMs: (c.videoS - c.audioS) * 1000,
    });
  }
  claps.sort((x, y) => x.audioS - y.audioS);
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

/** The claps in a mic's onsets and a camera's motion series. */
export const matchClaps = (o: {
  onsetsS: readonly number[];
  motion: readonly MotionPoint[];
}): ClapMatch => pairClaps(o.onsetsS, findContacts(o.motion));
