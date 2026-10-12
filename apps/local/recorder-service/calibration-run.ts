import { runToEnd, type Launcher } from "./launcher";
import type { CalibrationMeasurement, CalibrationWindow } from "./protocol";

/**
 * AN AUDIO CALIBRATION'S RUN (#2079): the level meter's process
 * (`level-meter.ts`), which also writes the mic to `mic.wav` in a folder of
 * its own, so the meter's readings are timed in that file's seconds (ebur128
 * counts the samples it passes on, and the file gets every one). When the
 * page says the script is done, the process quits and a second ffmpeg.exe
 * measures the file over the windows the page gives: the noise floor over
 * the silence, the integrated speech loudness over the reading rounds, and
 * the true peak over the whole take.
 */

/** The run's mic file, in the run's own folder. */
export const CALIBRATION_MIC_FILE = "mic.wav";

/** The run's mic output: raw 16-bit PCM, as dshow hands it over. */
export const calibrationOutput = [
  "-c:a",
  "pcm_s16le",
  "-y",
  CALIBRATION_MIC_FILE,
];

const trim = (w: CalibrationWindow) =>
  `atrim=start=${w.startSeconds}:end=${w.endSeconds}`;

/**
 * ffmpeg.exe's args to measure the run's file: astats' overall RMS level over
 * the silence, ebur128's integrated loudness over the speech windows, cut out
 * and joined end to end, and a second ebur128's true peak over the whole
 * take. (`aselect=between(t,…)` let every frame through on ffmpeg 8.0.1, so
 * the windows are `atrim`s and a `concat`.)
 */
export const calibrationAnalysisArgs = (o: {
  silence: CalibrationWindow;
  speech: readonly CalibrationWindow[];
}) => {
  const n = o.speech.length;
  const reads = o.speech.map((_, i) => `[r${i}]`).join("");
  const graph = [
    `[0:a]asplit=${n + 2}[n][p]${reads}`,
    `[n]${trim(o.silence)},astats=measure_perchannel=none:measure_overall=RMS_level,anullsink`,
    `[p]ebur128=peak=true:framelog=quiet,anullsink`,
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

/** Measures a run's file in `dir` (a WSL path); rejects with what ffmpeg said. */
export const measureCalibration = async (o: {
  launch: Launcher;
  dir: string;
  silence: CalibrationWindow;
  speech: readonly CalibrationWindow[];
}): Promise<CalibrationMeasurement> => {
  if (o.speech.length === 0) throw new Error("No speech windows to measure.");
  const { code, stderr } = await runToEnd(
    o.launch({
      tool: "ffmpeg",
      args: calibrationAnalysisArgs(o),
      cwd: o.dir,
    })
  );
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
