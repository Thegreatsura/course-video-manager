import { NodeContext } from "@effect/platform-node";
import { Effect } from "effect";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { detectClaps } from "@/packages/clap-detection";

/**
 * A synthetic AV Calibration take, made with ffmpeg and no device: a mic file
 * (48 kHz stereo 16-bit WAV, as the run writes it) with a clap at each
 * `audioS`, and a camera file (29.97 fps, as the run writes it) in which two
 * "hands" close in at a steady speed and meet at each `videoS`, rest a moment,
 * then part. Light noise in both, so nothing is perfectly still.
 *
 * The two ways 2026-10-12's real calibrations lost claps can be added: a
 * louder room (`hissDb`), so each clap rises only ~25 dB over it, and Matt
 * swaying the whole time (`sway`), a body at the frame's edge moving back
 * and forth. And the way their Mic Offset went wrong: a start-up gap
 * (`gap`), a run of exact silence in the mic just after it starts.
 */

const SAMPLE_RATE = 48_000;
const FPS_NUM = 30_000;
const FPS_DEN = 1001;
const W = 640;
const H = 360;
/** How long the hands take to close, rest together, and part, in s. */
const CLOSE_S = 0.25;
const REST_S = 0.15;
const PART_S = 0.5;
const OPEN_GAP = 240;
/** The swaying body: its width, how far its edge sways, and how often, in px and s. */
const BODY_W = 100;
const BODY_SWAY = 40;
const SWAY_PERIOD_S = 1.1;

/** A seeded random in [0, 1), so a fixture is the same every run. */
const random = (seed: number) => () => {
  seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
  return seed / 2_147_483_648;
};

const writeSyntheticTake = (o: {
  dir: string;
  durationS: number;
  audioS: readonly number[];
  videoS: readonly number[];
  hissDb?: number;
  sway?: boolean;
  gap?: { atS: number; ms: number };
}) => {
  const rand = random(42);

  // The mic: a hiss (-65 dBFS by default), and each clap a 0.3 ms rise into
  // a noise burst that dies away with an 8 ms time constant.
  const n = Math.round(o.durationS * SAMPLE_RATE);
  const mic = new Float32Array(n * 2);
  const hiss = 10 ** ((o.hissDb ?? -65) / 20);
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    if (o.gap && t >= o.gap.atS && t < o.gap.atS + o.gap.ms / 1000) continue;
    let x = (rand() - 0.5) * 2 * hiss;
    for (const a of o.audioS) {
      const dt = t - a;
      if (dt < 0 || dt > 0.2) continue;
      x +=
        0.6 *
        Math.min(dt / 0.0003, 1) *
        Math.exp(-dt / 0.008) *
        (rand() - 0.5) *
        2;
    }
    mic[i * 2] = x;
    mic[i * 2 + 1] = x;
  }
  const rawMic = path.join(o.dir, "mic.f32");
  writeFileSync(rawMic, Buffer.from(mic.buffer));
  const micFile = path.join(o.dir, "mic.wav");
  execFileSync("ffmpeg", [
    "-hide_banner",
    "-v",
    "error",
    "-y",
    "-f",
    "f32le",
    "-ar",
    String(SAMPLE_RATE),
    "-ac",
    "2",
    "-i",
    rawMic,
    "-c:a",
    "pcm_s16le",
    micFile,
  ]);

  // The camera: the gap between the hands at frame time t.
  const gapAt = (t: number) => {
    let gap = OPEN_GAP;
    for (const c of o.videoS) {
      const dt = t - c;
      if (dt >= -CLOSE_S && dt < 0)
        gap = Math.min(gap, (-dt / CLOSE_S) * OPEN_GAP);
      else if (dt >= 0 && dt < REST_S) gap = 0;
      else if (dt >= REST_S && dt < REST_S + PART_S)
        gap = Math.min(gap, ((dt - REST_S) / PART_S) * OPEN_GAP);
    }
    return gap;
  };
  const frames = Math.floor((o.durationS * FPS_NUM) / FPS_DEN);
  const video = Buffer.alloc(frames * W * H);
  const handW = 90;
  const top = 100;
  const bottom = 260;
  for (let f = 0; f < frames; f++) {
    const t = (f * FPS_DEN) / FPS_NUM;
    const gap = gapAt(t);
    const leftEdge = W / 2 - gap / 2;
    const rightEdge = W / 2 + gap / 2;
    // The swaying body's edge, at the frame's right.
    const bodyEdge = o.sway
      ? W - BODY_W + BODY_SWAY * Math.sin((2 * Math.PI * t) / SWAY_PERIOD_S)
      : W;
    const frame = video.subarray(f * W * H, (f + 1) * W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const hand =
          y >= top &&
          y < bottom &&
          ((x >= leftEdge - handW && x < leftEdge) ||
            (x >= rightEdge && x < rightEdge + handW));
        const body = x >= bodyEdge;
        frame[y * W + x] =
          (hand ? 200 : body ? 160 : 60) + Math.floor(rand() * 4);
      }
    }
  }
  const rawCamera = path.join(o.dir, "camera.gray");
  writeFileSync(rawCamera, video);
  const cameraFile = path.join(o.dir, "camera.mkv");
  execFileSync("ffmpeg", [
    "-hide_banner",
    "-v",
    "error",
    "-y",
    "-f",
    "rawvideo",
    "-pix_fmt",
    "gray",
    "-s",
    `${W}x${H}`,
    "-framerate",
    `${FPS_NUM}/${FPS_DEN}`,
    "-i",
    rawCamera,
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-crf",
    "18",
    "-pix_fmt",
    "yuv420p",
    cameraFile,
  ]);
  return { micFile, cameraFile };
};

/** One camera frame at 29.97 fps, in ms. */
const FRAME_MS = (1000 * FPS_DEN) / FPS_NUM;

/**
 * The real ffmpeg over synthetic AV Calibration takes (no device): claps at
 * known mic times, the hands meeting at known camera times, so the Mic
 * Offset each take should give is known. Skipped where there is no ffmpeg.
 */
const hasFfmpeg = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

const WINDOW = { startSeconds: 1, endSeconds: 9.5 };
const CLAPS_AUDIO_S = [2.013, 3.508, 5.021, 6.497, 8.004];

describe.skipIf(!hasFfmpeg)("clap detection over real files", () => {
  const root = path.join(tmpdir(), `claps-${process.pid}-${Date.now()}`);
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  const take = (
    name: string,
    offsetsMs: readonly number[],
    audioS = CLAPS_AUDIO_S,
    room: Pick<
      Parameters<typeof writeSyntheticTake>[0],
      "hissDb" | "sway" | "gap"
    > = {}
  ) => {
    const dir = path.join(root, name);
    mkdirSync(dir, { recursive: true });
    const files = writeSyntheticTake({
      dir,
      durationS: 10,
      audioS,
      videoS: CLAPS_AUDIO_S.map((a, i) => a + offsetsMs[i]! / 1000),
      ...room,
    });
    return Effect.runPromise(
      detectClaps({ ...files, window: WINDOW }).pipe(
        Effect.provide(NodeContext.layer)
      )
    );
  };

  it("finds all 5 claps and recovers the Mic Offset within one frame", async () => {
    // The camera 137 ms late, give or take a few ms per clap.
    const offsets = [137, 131, 142, 135, 140];
    const result = await take("clean", offsets);
    expect(result.found).toBe(5);
    expect(Math.abs(result.micOffsetMs! - 137)).toBeLessThan(FRAME_MS);
    expect(result.spreadMs!).toBeLessThanOrEqual(FRAME_MS);
    result.claps.forEach((c, i) => {
      expect(Math.abs(c.audioS - CLAPS_AUDIO_S[i]!)).toBeLessThan(0.001);
      // Well inside the frame the rule allows: a few ms.
      expect(Math.abs(c.offsetMs - offsets[i]!)).toBeLessThan(5);
    });
  }, 60_000);

  it("recovers a negative Mic Offset (the mic late) as well", async () => {
    const result = await take("negative", [-48, -52, -45, -50, -49]);
    expect(result.found).toBe(5);
    expect(Math.abs(result.micOffsetMs! - -49)).toBeLessThan(FRAME_MS);
  }, 60_000);

  it("finds only the claps heard: 2 of 5 when 3 make no sound", async () => {
    const result = await take(
      "two-heard",
      [137, 137, 137, 137, 137],
      [CLAPS_AUDIO_S[0]!, CLAPS_AUDIO_S[3]!]
    );
    expect(result.found).toBe(2);
  }, 60_000);

  it("reports claps that disagree by more than a frame", async () => {
    const result = await take("spread", [110, 137, 175, 140, 130]);
    expect(result.found).toBe(5);
    expect(result.spreadMs!).toBeGreaterThan(FRAME_MS);
    expect(Math.abs(result.spreadMs! - 65)).toBeLessThan(FRAME_MS);
  }, 60_000);

  it("finds claps that rise only ~25 dB over a louder room", async () => {
    const result = await take(
      "low-rise",
      [-50, -48, -52, -49, -51],
      CLAPS_AUDIO_S,
      { hissDb: -30 }
    );
    expect(result.found).toBe(5);
    expect(Math.abs(result.micOffsetMs! - -50)).toBeLessThan(FRAME_MS);
  }, 60_000);

  it("finds claps while Matt sways the whole time", async () => {
    const offsets = [-90, -88, -92, -91, -89];
    const result = await take("sway", offsets, CLAPS_AUDIO_S, { sway: true });
    expect(result.found).toBe(5);
    expect(Math.abs(result.micOffsetMs! - -90)).toBeLessThan(FRAME_MS);
    expect(result.spreadMs!).toBeLessThanOrEqual(FRAME_MS);
  }, 60_000);

  it("finds the claps but trusts no Mic Offset when the mic had a start-up gap", async () => {
    const offsets = [-50, -50, -50, -50, -50];
    const clean = await take("no-gap", offsets);
    expect(clean.startUpGap).toBeNull();
    const result = await take("gap", offsets, CLAPS_AUDIO_S, {
      gap: { atS: 0.4, ms: 150 },
    });
    expect(result.found).toBe(5);
    expect(result.micOffsetMs).toBeNull();
    expect(result.startUpGap!.atSeconds).toBeCloseTo(0.4, 2);
    expect(Math.abs(result.startUpGap!.ms - 150)).toBeLessThan(1);
  }, 60_000);
});
