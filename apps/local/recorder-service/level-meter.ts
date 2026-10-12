import { quitProcess } from "./camera";
import { METER_TAG, micInput } from "./capture-args";
import { lineSplitter, type Launcher } from "./launcher";
import type { MeterReading, RecorderMessage } from "./protocol";
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

/** ffmpeg.exe's args for the meter on `mic` (its DirectShow name). */
export const levelMeterArgs = (mic: string) => [
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
  "-f",
  "null",
  "-",
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
  onReading: (reading: MeterReading) => void;
  /** It quit without being asked: the last line it printed, if any. */
  onExit: (lastLine: string | undefined) => void;
}): LevelMeter => {
  const p = o.launch({
    tool: "ffmpeg",
    args: levelMeterArgs(o.mic),
    cwd: "/mnt/c",
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

/**
 * The service's one level meter, run for one client (`Owner`, its socket) at
 * a time: started already, a start hands it to the client that asked. It
 * stops when asked or when that client goes, so a client that dies never
 * leaves the mic open and Record refused. Whether it may start at all (not
 * while recording) is the service's to decide.
 */
export const createMeterSide = <Owner>(o: {
  launch: Launcher;
  broadcast: (message: RecorderMessage) => void;
}) => {
  let current: { meter: LevelMeter; owner: Owner } | undefined;

  const stop = async () => {
    const stopped = current;
    if (!stopped) return;
    current = undefined;
    await stopped.meter.stop();
    o.broadcast({ type: "meter-stopped", message: null });
  };

  return {
    running: () => current !== undefined,
    start: async (owner: Owner) => {
      if (current) {
        current.owner = owner;
        return;
      }
      const { devices } = await listDshowDevices(o.launch);
      const audio = devices
        .filter((d) => d.kind === "audio")
        .map((d) => d.name);
      const mic = findByName(audio, (n) => n, MIC_NAME);
      if (!mic)
        throw new Refusal(
          `${MIC_NAME} (audio) is not among the DirectShow devices. Found: ${audio.join(", ") || "none"}`
        );
      const started = {
        owner,
        meter: startLevelMeter({
          launch: o.launch,
          mic,
          onReading: (reading) =>
            o.broadcast({ type: "meter-reading", ...reading }),
          onExit: (lastLine) => {
            if (current !== started) return;
            current = undefined;
            o.broadcast({
              type: "meter-stopped",
              message: `The level meter's ffmpeg quit${lastLine ? `: ${lastLine}` : "."}`,
            });
          },
        }),
      };
      current = started;
      o.broadcast({ type: "meter-started", mic });
    },
    stop,
    /** A client went: the meter stops if it ran for that client. */
    ownerWent: (owner: Owner) =>
      current?.owner === owner ? stop() : Promise.resolve(),
  };
};
