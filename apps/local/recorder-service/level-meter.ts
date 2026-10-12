import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  CALIBRATION_MIC_FILE,
  calibrationOutput,
  measureCalibration,
} from "./calibration-run";
import { quitProcess } from "./camera";
import { METER_TAG, micInput } from "./capture-args";
import { lineSplitter, type Launcher } from "./launcher";
import type {
  CalibrationWindow,
  MeterReading,
  RecorderMessage,
} from "./protocol";
import { findByName, Refusal } from "./refusal";
import { listDshowDevices } from "./windows-devices";
import { MIC_NAME } from "../app/mic-device";

/**
 * THE LEVEL METER (#2078): the Audio Calibration page's live loudness of the
 * mic. A mic-only ffmpeg.exe on the mic the CVM recorder records, opened as
 * the recording opens it (`micInput`: raw, pre-EQ), through ffmpeg's ebur128,
 * which logs momentary (400 ms) and short-term (3 s) loudness every 100 ms.
 * It needs no Video and no camera, and it changes no device and no level: it
 * only listens.
 */

/**
 * ffmpeg.exe's args for the meter on `mic` (its DirectShow name). `output`:
 * a calibration run's file; undefined for the plain meter, which writes none.
 */
export const levelMeterArgs = (
  mic: string,
  output: readonly string[] | undefined
) => [
  "-hide_banner",
  "-nostats",
  "-loglevel",
  "level+info",
  ...micInput(mic),
  "-af",
  // framelog=info: ebur128 logs each 100 ms reading at info, not verbose.
  "ebur128=framelog=info",
  "-metadata",
  `comment=${METER_TAG}`,
  ...(output ?? ["-f", "null", "-"]),
];

const NUMBER = String.raw`(-?(?:[\d.]+|inf)|nan)`;
const READING = new RegExp(
  String.raw`\bt:\s*([\d.]+)\s+TARGET:.*?\bM:\s*${NUMBER}\s+S:\s*${NUMBER}`
);

/** ebur128 says -inf, nan or -120.7 before it has heard anything. */
const loudness = (s: string) => {
  const n = Number(s.replace(/^-inf$/, "-Infinity"));
  return Number.isFinite(n) ? n : -120.7;
};

/** The reading on one ebur128 stderr line, if it carries one. */
export const parseMeterLine = (line: string): MeterReading | undefined => {
  const m = line.match(READING);
  if (!m) return undefined;
  return {
    seconds: Number(m[1]),
    momentaryLufs: loudness(m[2]!),
    shortTermLufs: loudness(m[3]!),
  };
};

export type LevelMeter = {
  /** Quits the meter's ffmpeg.exe (killing it, by its tag, if `q` is not heard). */
  stop: () => Promise<void>;
};

export const startLevelMeter = (o: {
  launch: Launcher;
  mic: string;
  /** A calibration run's folder (WSL path), its mic file written there; undefined for the plain meter. */
  calibrationDir: string | undefined;
  onReading: (reading: MeterReading) => void;
  /** It quit without being asked: the last line it printed, if any. */
  onExit: (lastLine: string | undefined) => void;
}): LevelMeter => {
  const p = o.launch({
    tool: "ffmpeg",
    args: levelMeterArgs(
      o.mic,
      o.calibrationDir ? calibrationOutput : undefined
    ),
    cwd: o.calibrationDir ?? "/mnt/c",
  });
  let stopping = false;
  let lastLine: string | undefined;
  p.onStderr(
    lineSplitter((line) => {
      const reading = parseMeterLine(line);
      if (reading) return o.onReading(reading);
      if (line.trim()) lastLine = line.trim();
    })
  );
  void p.exited.then(() => {
    if (!stopping) o.onExit(lastLine);
  });
  return {
    stop: () => {
      stopping = true;
      return quitProcess(p, { launch: o.launch, tag: METER_TAG });
    },
  };
};

/** A calibration run in progress: its id, its folder and its mic file (WSL paths). */
type CalibrationRun = { id: string; dir: string; micFile: string };

/**
 * The service's one level meter, run for one client (`Owner`, its socket) at
 * a time: started already, a start hands it to the client that asked. It
 * stops when asked or when that client goes, so a client that dies never
 * leaves the mic open and Record refused. Whether it may start at all (not
 * while recording) is the service's to decide.
 *
 * An Audio Calibration's run takes the meter's place for a while: the same
 * mic, one process, now also writing a file (`calibration-run.ts`). Finished
 * or cancelled, the plain meter comes back for the same client; stopped, or
 * its client gone, the run is discarded with the meter. A discarded run
 * leaves no file.
 */
export const createMeterSide = <Owner>(o: {
  launch: Launcher;
  broadcast: (message: RecorderMessage) => void;
  /** Windows wall-clock ms, for a run's folder name. */
  now: () => number;
}) => {
  let current:
    | { meter: LevelMeter; owner: Owner; mic: string; run?: CalibrationRun }
    | undefined;

  const findMic = async () => {
    const { devices } = await listDshowDevices(o.launch);
    const audio = devices.filter((d) => d.kind === "audio").map((d) => d.name);
    const mic = findByName(audio, (n) => n, MIC_NAME);
    if (!mic)
      throw new Refusal(
        `${MIC_NAME} (audio) is not among the DirectShow devices. Found: ${audio.join(", ") || "none"}`
      );
    return mic;
  };

  const launchMeter = (owner: Owner, mic: string, run?: CalibrationRun) => {
    const started = {
      owner,
      mic,
      run,
      meter: startLevelMeter({
        launch: o.launch,
        mic,
        calibrationDir: run?.dir,
        onReading: (reading) =>
          o.broadcast({ type: "meter-reading", ...reading }),
        onExit: (lastLine) => {
          if (current !== started) return;
          current = undefined;
          const message = `The level meter's ffmpeg quit${lastLine ? `: ${lastLine}` : "."}`;
          if (run) {
            discard(run);
            o.broadcast({
              type: "calibration-ended",
              calibrationId: run.id,
              message,
            });
          }
          o.broadcast({ type: "meter-stopped", message });
        },
      }),
    };
    current = started;
  };

  const discard = (run: CalibrationRun) => {
    try {
      fs.rmSync(run.dir, { recursive: true, force: true });
    } catch (e) {
      console.error(`recorder: could not delete ${run.dir}`, e);
    }
  };

  /** Ends a run's process; the caller brings the plain meter back. */
  const endRun = async () => {
    const ending = current;
    if (!ending?.run) throw new Refusal("No Audio Calibration is running.");
    current = undefined;
    await ending.meter.stop();
    return ending as typeof ending & { run: CalibrationRun };
  };

  const stop = async () => {
    const stopped = current;
    if (!stopped) return;
    current = undefined;
    await stopped.meter.stop();
    if (stopped.run) {
      discard(stopped.run);
      o.broadcast({
        type: "calibration-ended",
        calibrationId: stopped.run.id,
        message: null,
      });
    }
    o.broadcast({ type: "meter-stopped", message: null });
  };

  return {
    running: () => current !== undefined,
    start: async (owner: Owner) => {
      if (current) {
        current.owner = owner;
        return;
      }
      const mic = await findMic();
      launchMeter(owner, mic);
      o.broadcast({ type: "meter-started", mic });
    },
    startCalibration: async (owner: Owner, folder: string) => {
      if (current?.run)
        throw new Refusal("An Audio Calibration is already running.");
      if (!path.isAbsolute(folder))
        throw new Refusal(`The folder must be an absolute path: ${folder}`);
      const mic = current?.mic ?? (await findMic());
      const id = randomUUID();
      const stamp = new Date(o.now())
        .toISOString()
        .slice(0, 19)
        .replace(/:/g, "-");
      const dir = path.join(
        folder,
        CALIBRATIONS_FOLDER,
        `${stamp} ${id.slice(0, 8)}`
      );
      fs.mkdirSync(dir, { recursive: true });
      const run = { id, dir, micFile: path.join(dir, CALIBRATION_MIC_FILE) };
      // One process holds the mic: the plain meter makes way for the run.
      const before = current;
      current = undefined;
      await before?.meter.stop();
      launchMeter(owner, mic, run);
      o.broadcast({
        type: "calibration-started",
        calibrationId: id,
        mic,
        micFile: run.micFile,
      });
    },
    finishCalibration: async (windows: {
      silence: CalibrationWindow;
      speech: readonly CalibrationWindow[];
    }) => {
      const { run, owner, mic } = await endRun();
      try {
        const measured = await measureCalibration({
          launch: o.launch,
          dir: run.dir,
          ...windows,
        });
        o.broadcast({
          type: "calibration-measured",
          calibrationId: run.id,
          mic,
          micFile: run.micFile,
          ...measured,
        });
      } catch (e) {
        discard(run);
        const message = e instanceof Error ? e.message : String(e);
        o.broadcast({
          type: "calibration-ended",
          calibrationId: run.id,
          message,
        });
        throw new Refusal(message);
      } finally {
        launchMeter(owner, mic);
      }
    },
    cancelCalibration: async () => {
      const { run, owner, mic } = await endRun();
      discard(run);
      o.broadcast({
        type: "calibration-ended",
        calibrationId: run.id,
        message: null,
      });
      launchMeter(owner, mic);
    },
    stop,
    /** A client went: the meter (and any run) stops if it ran for that client. */
    ownerWent: (owner: Owner) =>
      current?.owner === owner ? stop() : Promise.resolve(),
  };
};

/** Where calibration runs go, under the recordings folder. */
export const CALIBRATIONS_FOLDER = "audio-calibrations";
