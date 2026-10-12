import { describe, expect, it } from "vitest";
import { matchClaps, type MotionPoint } from "@/packages/clap-detection";

/**
 * The pure matcher over hand-made series: mic onsets, and a camera motion
 * series in which the hands close at a steady speed (a plateau of motion)
 * and stop dead at each contact.
 */

const FRAME_S = 1001 / 30_000;
const FRAME_MS = FRAME_S * 1000;

/** 10 s of 29.97 fps motion, with the hands meeting at each `contactsS`. */
const motion = (contactsS: readonly number[]): MotionPoint[] =>
  Array.from({ length: Math.floor(10 / FRAME_S) }, (_, i) => {
    const t = i * FRAME_S;
    // This frame's motion: how much of its interval (t - frame, t] the
    // hands spent closing (they close over 0.25 s before contact).
    let moving = 0;
    for (const c of contactsS) {
      const from = Math.max(t - FRAME_S, c - 0.25);
      const to = Math.min(t, c);
      moving += Math.max(0, to - from) / FRAME_S;
    }
    // A little sensor noise.
    return { seconds: t, level: 0.2 + 0.05 * Math.sin(i * 1.7) + 6 * moving };
  });

const AUDIO = [2.013, 3.508, 5.021, 6.497, 8.004];
const at = (offsetsMs: readonly number[]) =>
  AUDIO.map((a, i) => a + offsetsMs[i]! / 1000);

describe("matchClaps", () => {
  it("pairs 5 clean claps and takes the median offset", () => {
    const offsets = [150, 146, 155, 151, 149];
    const result = matchClaps({ onsetsS: AUDIO, motion: motion(at(offsets)) });
    expect(result.found).toBe(5);
    expect(Math.abs(result.micOffsetMs! - 150)).toBeLessThan(3);
    expect(Math.abs(result.spreadMs! - 9)).toBeLessThan(3);
    expect(result.claps.map((c) => c.audioS)).toEqual(AUDIO);
  });

  it("finds 2 when only 2 claps were heard", () => {
    const result = matchClaps({
      onsetsS: [AUDIO[1]!, AUDIO[4]!],
      motion: motion(at([150, 150, 150, 150, 150])),
    });
    expect(result.found).toBe(2);
    expect(Math.abs(result.micOffsetMs! - 150)).toBeLessThan(3);
  });

  it("measures a spread of more than one frame", () => {
    const result = matchClaps({
      onsetsS: AUDIO,
      motion: motion(at([120, 150, 165, 150, 150])),
    });
    expect(result.found).toBe(5);
    expect(result.spreadMs!).toBeGreaterThan(FRAME_MS);
    expect(Math.abs(result.spreadMs! - 45)).toBeLessThan(3);
    expect(Math.abs(result.micOffsetMs! - 150)).toBeLessThan(3);
  });

  it("is not fooled by a transient the camera saw no movement for", () => {
    // A knock 400 ms after the third clap: near enough that clap's contact
    // to pair with it, but the clap's own onset is nearer.
    const knock = AUDIO[2]! + 0.4;
    const result = matchClaps({
      onsetsS: [...AUDIO.slice(0, 3), knock, ...AUDIO.slice(3)],
      motion: motion(at([150, 150, 150, 150, 150])),
    });
    expect(result.found).toBe(5);
    expect(result.claps.map((c) => c.audioS)).not.toContain(knock);
    expect(result.spreadMs!).toBeLessThan(3);
  });

  it("finds nothing in stillness", () => {
    const result = matchClaps({ onsetsS: AUDIO, motion: motion([]) });
    expect(result).toEqual({
      claps: [],
      found: 0,
      spreadMs: null,
      micOffsetMs: null,
    });
  });
});
