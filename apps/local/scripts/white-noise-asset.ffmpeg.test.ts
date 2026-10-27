import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ensureWhiteNoiseAsset } from "./white-noise-asset";

/**
 * The white noise an **Effect Clip** plays, measured with the real ffmpeg.
 * Skipped where there is no ffmpeg.
 */
const hasFfmpeg = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

const integratedLufs = (file: string): number => {
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
  return Number([...out.matchAll(/I:\s+(-?[\d.]+) LUFS/g)].at(-1)![1]);
};

describe.skipIf(!hasFfmpeg)("the white noise asset", () => {
  it("replaces an asset made at the old level (-33 LUFS, about 5 LU under Matt's raw dialogue) with one at -45 LUFS, about 18 LU under it", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "white-noise-"));
    const file = path.join(dir, "white-noise.mp4");
    // The asset as generate-assets made it before: pink noise at -18 dB.
    execFileSync("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "anoisesrc=color=pink:d=1.0",
      "-af",
      "volume=-18dB",
      "-c:a",
      "aac",
      file,
    ]);

    ensureWhiteNoiseAsset(file);

    expect(integratedLufs(file)).toBeGreaterThan(-46.5);
    expect(integratedLufs(file)).toBeLessThan(-44);
    fs.rmSync(dir, { recursive: true });
    // Its picture is a slow x264 encode.
  }, 60_000);
});
