import fs from "node:fs";
import path from "node:path";
import { runToEnd, type Launcher } from "./launcher";
import type { CalibrationMeasurement, CalibrationWindow } from "./protocol";

/**
 * AN AV CALIBRATION'S RUN (#2079, #2095): the level meter's process
 * (`level-meter.ts`) made a capture. It opens the camera as well as the mic,
 * both on the shared clock a Recording Session uses
 * (`calibrationCaptureArgs`), and writes the mic to `mic.wav` and the camera
 * to `camera.mkv` in a folder of its own. The meter's readings are timed in
 * the files' seconds (ebur128 counts the samples it passes on, and the file
 * gets every one). When the page says the script is done, the process quits
 * and a second ffmpeg.exe measures the mic file over the windows the page
 * gives: the noise floor over the silence, the integrated speech loudness
 * over the reading rounds, and the true peak over the whole take less the
 * clap window (a clap must never fail the level check). The claps
 * themselves are found by the app server (`clap-detection`). Both
 * processes' ffmpeg logs are kept in the folder, so a stall in the capture
 * (a start-up gap in the mic) can be confirmed afterwards.
 */

/** The run's mic file, in the run's own folder. */
export const CALIBRATION_MIC_FILE = "mic.wav";
/** The run's camera file, beside it. */
export const CALIBRATION_CAMERA_FILE = "camera.mkv";
/** The capture's ffmpeg log (all it printed), beside them... */
export const CALIBRATION_CAPTURE_LOG = "ffmpeg-capture.log";
/** ...and the measurement's. */
export const CALIBRATION_ANALYSIS_LOG = "ffmpeg-analysis.log";

const trim = (w: CalibrationWindow) =>
  `atrim=start=${w.startSeconds}:end=${w.endSeconds}`;

/**
 * ffmpeg.exe's args to measure the run's file: astats' overall RMS level over
 * the silence, ebur128's integrated loudness over the speech windows, cut out
 * and joined end to end, and a second ebur128's true peak over the take with
 * the clap window cut out. (`aselect=between(t,…)` let every frame through on
 * ffmpeg 8.0.1, so the windows are `atrim`s and a `concat`.)
 */
export const calibrationAnalysisArgs = (o: {
  silence: CalibrationWindow;
  speech: readonly CalibrationWindow[];
  claps: CalibrationWindow;
}) => {
  const n = o.speech.length;
  const reads = o.speech.map((_, i) => `[r${i}]`).join("");
  const graph = [
    `[0:a]asplit=${n + 3}[n][pa][pb]${reads}`,
    `[n]${trim(o.silence)},astats=measure_perchannel=none:measure_overall=RMS_level,anullsink`,
    `[pa]atrim=end=${o.claps.startSeconds},asetpts=PTS-STARTPTS[p0]`,
    `[pb]atrim=start=${o.claps.endSeconds},asetpts=PTS-STARTPTS[p1]`,
    `[p0][p1]concat=n=2:v=0:a=1,ebur128=peak=true:framelog=quiet,anullsink`,
    ...o.speech.map((w, i) => `[r${i}]${trim(w)},asetpts=PTS-STARTPTS[s${i}]`),
    `${o.speech.map((_, i) => `[s${i}]`).join("")}concat=n=${n}:v=0:a=1,ebur128=framelog=verbose[out]`,
  ].join(";");
  return [
    "-hide_banner",
    "-nostats",
    "-loglevel",
    "level+info",
    "-i",
    CALIBRATION_MIC_FILE,
    "-filter_complex",
    graph,
    "-map",
    "[out]",
    "-f",
    "null",
    "-",
  ];
};

/**
 * astats says `-inf` for digital silence (a gated mic): stored as -120 dBFS,
 * ebur128's own floor, so the noise floor is always a number.
 */
export const DIGITAL_SILENCE_DB = -120;

const NUMBER = String.raw`(-?[\d.]+|-inf)`;
const RMS = new RegExp(String.raw`\bRMS level dB:\s*${NUMBER}`);
/**
 * Each ebur128's Summary: its header, then the unprefixed lines up to the
 * next prefixed one (frame lines and other filters' lines start with `[`).
 * The two print in no fixed order, so each is told apart by what it holds.
 */
const SUMMARY =
  /\[Parsed_ebur128_\d+ @ [^\]]*\] \[info\] Summary:((?:\r?\n(?!\[).*)*)/g;
const INTEGRATED = new RegExp(String.raw`^\s+I:\s*${NUMBER}\s+LUFS`, "m");
/** Only the whole-take ebur128 has `peak=true`, so only its Summary has this. */
const TRUE_PEAK = new RegExp(
  String.raw`True peak:\s*\r?\n\s+Peak:\s*${NUMBER}\s+dBFS`
);

const level = (s: string) =>
  s === "-inf" ? DIGITAL_SILENCE_DB : Math.max(Number(s), DIGITAL_SILENCE_DB);

/** The measurement in the analysis' stderr, or undefined when it has none. */
export const parseCalibrationAnalysis = (
  stderr: string
): CalibrationMeasurement | undefined => {
  const rms = stderr.match(RMS)?.[1];
  let integrated: string | undefined;
  let truePeak: string | undefined;
  for (const [, summary = ""] of stderr.matchAll(SUMMARY)) {
    const peak = summary.match(TRUE_PEAK)?.[1];
    if (peak !== undefined) truePeak = peak;
    else integrated = summary.match(INTEGRATED)?.[1];
  }
  if (rms === undefined || integrated === undefined || truePeak === undefined)
    return undefined;
  return {
    noiseFloorDb: level(rms),
    speechLufs: level(integrated),
    truePeakDb: level(truePeak),
  };
};

/**
 * Measures a run's file in `dir` (a WSL path), keeping ffmpeg's log beside
 * it; rejects with what ffmpeg said.
 */
export const measureCalibration = async (o: {
  launch: Launcher;
  dir: string;
  silence: CalibrationWindow;
  speech: readonly CalibrationWindow[];
  claps: CalibrationWindow;
}): Promise<CalibrationMeasurement> => {
  if (o.speech.length === 0) throw new Error("No speech windows to measure.");
  const { code, stderr } = await runToEnd(
    o.launch({
      tool: "ffmpeg",
      args: calibrationAnalysisArgs(o),
      cwd: o.dir,
    })
  );
  fs.writeFileSync(path.join(o.dir, CALIBRATION_ANALYSIS_LOG), stderr);
  const measured = code === 0 ? parseCalibrationAnalysis(stderr) : undefined;
  if (!measured) {
    const said = stderr
      .split(/\r?\n/)
      .filter((l) => /\[(error|fatal)\]/.test(l))
      .slice(-3)
      .join(" ");
    throw new Error(
      `Could not measure the calibration's mic file (ffmpeg exited ${code})${said ? `: ${said}` : "."}`
    );
  }
  return measured;
};
