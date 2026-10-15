import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import {
  BURST_PERIOD_SECONDS,
  CLOCK_BITS,
  CLOCK_HEIGHT,
  CLOCK_MOD,
  CLOCK_WIDTH,
  clockBitCentre,
} from "./synthetic-sources";

/**
 * Reading a take's Footage back (Linux ffmpeg in WSL, on the GPU when it
 * can): each picture frame's burned-in capture time, the mic's first sound
 * and its bursts' onsets, and whether a file plays at all.
 */

const FRAME_BYTES = CLOCK_WIDTH * CLOCK_HEIGHT;

/** Reads a 320x180 grey frame's clock. */
const readClock = (frame: Buffer) => {
  let v = 0;
  for (let k = 0; k < CLOCK_BITS; k++) {
    const { x, y } = clockBitCentre(k);
    if (frame[y * CLOCK_WIDTH + x]! > 128) v += 2 ** k;
  }
  return v;
};

const decodeArgs = (file: string, gpu: boolean) => [
  "-hide_banner",
  "-v",
  "error",
  ...(gpu ? ["-hwaccel", "cuda", "-hwaccel_output_format", "cuda"] : []),
  "-i",
  file,
  "-map",
  "0:v:0",
  "-vf",
  gpu
    ? `scale_cuda=${CLOCK_WIDTH}:${CLOCK_HEIGHT}:interp_algo=bilinear,hwdownload,format=nv12,format=gray`
    : `scale=${CLOCK_WIDTH}:${CLOCK_HEIGHT}:flags=area,format=gray`,
  "-f",
  "rawvideo",
  "-",
];

const decodeWith = (file: string, gpu: boolean) =>
  new Promise<number[] | null>((resolve) => {
    const child = spawn("ffmpeg", decodeArgs(file, gpu), {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const values: number[] = [];
    let pending = Buffer.alloc(0);
    child.stdout.on("data", (d: Buffer) => {
      pending = Buffer.concat([pending, d]);
      while (pending.length >= FRAME_BYTES) {
        values.push(readClock(pending.subarray(0, FRAME_BYTES)));
        pending = pending.subarray(FRAME_BYTES);
      }
    });
    child.stderr.on("data", () => {});
    child.once("close", (code) =>
      resolve(code === 0 && values.length > 0 ? values : null)
    );
    child.once("error", () => resolve(null));
  });

/** Each frame's burned-in clock (Windows ms, mod 2^28), in file order. */
export const decodeClocks = async (file: string) =>
  (await decodeWith(file, true)) ?? (await decodeWith(file, false)) ?? [];

/** A clock value unwrapped to the full Windows ms nearest `near`. */
export const unwrap = (v: number, near: number) => {
  const d = (((v - near) % CLOCK_MOD) + CLOCK_MOD) % CLOCK_MOD;
  return near + (d > CLOCK_MOD / 2 ? d - CLOCK_MOD : d);
};

const median = (xs: number[]) => {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
};

/**
 * How many of `n` samples the start and the end of a take are each read
 * over for drift: a minute's worth, but never more than a quarter, so the
 * two never overlap on a short take.
 */
export const driftWindow = (n: number, perMinute = n) =>
  Math.max(1, Math.min(perMinute, Math.floor(n / 4)));

export type PictureReport = {
  frames: number;
  /** Frames at the head that repeat the first real one (back to T0). */
  leadingRepeats: number;
  /** The first real frame's capture time, Windows ms. */
  firstCaptureMs: number;
  /** Frames repeated after the head: the picture stood still. */
  repeated: number;
  /** Frames missing: a jump in capture time past 1.5 frame intervals. */
  dropped: number;
  /** Reads that fit neither neighbour (encode or decode noise), left out. */
  unreadable: number;
  /** How far behind file time the picture's capture time runs, ms: first and last minute (median). */
  lagStartMs: number;
  lagEndMs: number;
};

/**
 * What a picture file's clocks say. `fps` is the file's CFR rate, `t0Ms` the
 * Recording Session's T0 on the Windows clock.
 */
export const analysePicture = (
  clocks: number[],
  o: { fps: number; t0Ms: number }
): PictureReport => {
  const interval = 1000 / o.fps;
  const full = clocks.map((v) => unwrap(v, o.t0Ms));
  // A misread frame sits far from both neighbours, which agree with each other.
  let unreadable = 0;
  for (let n = 1; n < full.length - 1; n++) {
    const prev = full[n - 1]!;
    const next = full[n + 1]!;
    const here = full[n]!;
    const span = next - prev;
    const fits = here >= prev - 1 && here <= next + 1;
    if (!fits && span >= 0 && span <= 3 * interval) {
      full[n] = prev;
      unreadable += 1;
    }
  }
  let lead = 0;
  while (lead + 1 < full.length && full[lead + 1] === full[0]) lead++;
  let repeated = 0;
  let dropped = 0;
  for (let n = lead + 1; n < full.length; n++) {
    const d = full[n]! - full[n - 1]!;
    if (d === 0) repeated += 1;
    else if (d > 1.5 * interval) dropped += Math.round(d / interval) - 1;
  }
  const lag = (n: number) => o.t0Ms + (n * 1000) / o.fps - full[n]!;
  const span = driftWindow(full.length - lead - 1, Math.round(60 * o.fps));
  const startIdx = Array.from({ length: span }, (_, i) => lead + 1 + i);
  const endIdx = Array.from({ length: span }, (_, i) => full.length - 1 - i);
  return {
    frames: full.length,
    leadingRepeats: lead,
    firstCaptureMs: full[0] ?? NaN,
    repeated,
    dropped,
    unreadable,
    lagStartMs: median(startIdx.map(lag)),
    lagEndMs: median(endIdx.map(lag)),
  };
};

const ffmpegLog = (args: string[]) =>
  spawnSync("ffmpeg", ["-hide_banner", "-nostats", ...args], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  }).stderr;

export type MicReport = {
  /** File time of the first non-silent sample (s): before it, aresample's padding. */
  firstSoundSeconds: number;
  /** File times of each burst's onset (s). */
  onsets: number[];
  /** How far the bursts moved against their own period, ms: first and last minute (median). */
  driftStartMs: number;
  driftEndMs: number;
};

export const analyseMic = (file: string): MicReport => {
  const first = ffmpegLog([
    "-i",
    file,
    "-af",
    "silencedetect=n=-70dB:d=0.002",
    "-f",
    "null",
    "-",
  ]);
  const starts = [...first.matchAll(/silence_start: (-?[\d.]+)/g)].map((m) =>
    Number(m[1])
  );
  const ends = [...first.matchAll(/silence_end: (-?[\d.]+)/g)].map((m) =>
    Number(m[1])
  );
  const firstSoundSeconds =
    starts.length > 0 && starts[0]! <= 0.001 ? (ends[0] ?? NaN) : 0;
  const bursts = ffmpegLog([
    "-i",
    file,
    "-af",
    "silencedetect=n=-20dB:d=0.5",
    "-f",
    "null",
    "-",
  ]);
  const onsets = [...bursts.matchAll(/silence_end: (-?[\d.]+)/g)].map((m) =>
    Number(m[1])
  );
  const a0 = onsets[0] ?? 0;
  const residual = (a: number) =>
    (a -
      a0 -
      BURST_PERIOD_SECONDS * Math.round((a - a0) / BURST_PERIOD_SECONDS)) *
    1000;
  const span = driftWindow(onsets.length, Math.ceil(60 / BURST_PERIOD_SECONDS));
  return {
    firstSoundSeconds,
    onsets,
    driftStartMs: median(onsets.slice(0, span).map(residual)),
    driftEndMs: median(onsets.slice(-span).map(residual)),
  };
};

export type Playable = {
  exists: boolean;
  durationSeconds: number | null;
  decodeErrors: number;
};

/** Whether a file opens with a duration and decodes without errors. */
export const playable = (file: string): Playable => {
  if (!fs.existsSync(file))
    return { exists: false, durationSeconds: null, decodeErrors: 0 };
  const probe = spawnSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file],
    { encoding: "utf8" }
  );
  const duration = Number(probe.stdout.trim());
  const decode = ffmpegLog(["-v", "error", "-i", file, "-f", "null", "-"]);
  return {
    exists: true,
    durationSeconds:
      Number.isFinite(duration) && duration > 0 ? duration : null,
    decodeErrors: decode.split("\n").filter((l) => l.trim()).length,
  };
};

export const isPlayable = (p: Playable) =>
  p.exists && p.durationSeconds !== null && p.decodeErrors === 0;
