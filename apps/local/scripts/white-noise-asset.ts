import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

/**
 * How loud the white noise an **Effect Clip** plays is, as the asset holds
 * it: integrated loudness, in LUFS.
 *
 * About 18 LU under Matt's dialogue as it is recorded (around -27.5 LUFS,
 * OBS and CVM recorder alike). An Effect Clip goes through the same export
 * as the Clips beside it, and the export's `loudnorm` (I=-16) lifts the
 * whole Video by about the same amount, so the gap survives: the noise ends
 * near -34 LUFS against dialogue at -16. The editor's preview boost lifts
 * both alike too.
 *
 * 18 LU is the middle of the 15–20 LU a bed or transition effect sits under
 * speech. The noise is heard alone, in a gap between Clips, and it is a
 * steady broadband hiss whose every moment is as loud as its whole, where
 * speech peaks 6–8 LU above its own integrated loudness: so it errs to the
 * quiet side of that range. It was -33 LUFS, about 5 LU under dialogue,
 * which viewers called too loud and jarring.
 */
export const WHITE_NOISE_LOUDNESS_LUFS = -45;

/** How far an existing asset may sit from the level before it is remade. */
const TOLERANCE_LU = 1;

const integratedLoudness = (file: string): number => {
  // ebur128 prints its summary on stderr.
  const out = spawnSync(
    "ffmpeg",
    [
      "-hide_banner",
      "-nostats",
      "-i",
      file,
      "-map",
      "0:a",
      "-af",
      "ebur128",
      "-f",
      "null",
      "-",
    ],
    { encoding: "utf8" }
  ).stderr;
  const all = [...out.matchAll(/I:\s+(-?[\d.]+) LUFS/g)];
  return Number(all.at(-1)?.[1] ?? Number.NaN);
};

const generate = (file: string) => {
  mkdirSync(path.dirname(file), { recursive: true });
  execFileSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "nullsrc=s=854x480:d=1.0,geq=random(1)*255:128:128,format=gray",
      "-f",
      "lavfi",
      "-i",
      "anoisesrc=color=pink:d=1.0",
      "-c:v",
      "libx264",
      "-preset",
      "veryslow",
      "-crf",
      "30",
      "-pix_fmt",
      "yuv420p",
      "-af",
      `loudnorm=I=${WHITE_NOISE_LOUDNESS_LUFS}:TP=-9:LRA=1,aresample=48000`,
      "-c:a",
      "aac",
      "-b:a",
      "64k",
      "-shortest",
      file,
    ],
    { stdio: "inherit" }
  );
};

/**
 * Make the white noise asset at {@link WHITE_NOISE_LOUDNESS_LUFS}, unless the
 * one already there is at that level. An asset made at an older level is
 * remade in place: Effect Clips keep its path.
 */
export const ensureWhiteNoiseAsset = (file: string): "kept" | "generated" => {
  if (
    existsSync(file) &&
    Math.abs(integratedLoudness(file) - WHITE_NOISE_LOUDNESS_LUFS) <=
      TOLERANCE_LU
  ) {
    return "kept";
  }
  generate(file);
  return "generated";
};
