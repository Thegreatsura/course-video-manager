import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { SilenceLength } from "../app/silence-detection-constants";
import { buildCaptureArgs, FILE_NAMES } from "./capture-args";
import {
  lineSplitter,
  runToEnd,
  type LaunchedProcess,
  type Launcher,
} from "./launcher";
import type { RecordingSessionEvent, RecordingSessionFiles } from "./protocol";
import { createSpeechDetector } from "./speech-detector";

/**
 * ONE RECORDING SESSION, start to stop: the two ffmpeg.exe processes, their
 * logs, and the Recording Session's event log. Everything it reports goes
 * through `log`, which numbers it, appends it to `events.jsonl` and only then
 * hands it on, so nothing is sent that a replay could not send again.
 */

/** How long `q` gets to close the files before the process is killed. */
const STOP_TIMEOUT_MS = 20_000;

export const EVENT_LOG_NAME = "events.jsonl";

/** Distributes Omit over a union, which the built-in does not. */
type Unlogged = RecordingSessionEvent extends infer E
  ? E extends RecordingSessionEvent
    ? Omit<E, "seq" | "recordingSessionId">
    : never
  : never;

export type RecordingSessionOptions = {
  launch: Launcher;
  /** Windows wall-clock ms: the clock ffmpeg stamps every input with. */
  now: () => number;
  videoId: string;
  /** The folder (WSL path) the Recording Session's own folder goes in. */
  folder: string;
  silenceLength: SilenceLength;
  camera: string;
  mic: string;
  screenIndex: number;
  /** Each event, after it is in the log. */
  emit: (event: RecordingSessionEvent) => void;
  /** Once, after `recording-stopped`. */
  onEnded: () => void;
};

export type RecordingSession = {
  id: string;
  eventLog: string;
  lastSeq: () => number;
  stop: () => Promise<void>;
};

/** The last few error lines a process printed, for why it quit. */
const errorTail = (log: string) =>
  log
    .split(/\r?\n/)
    .filter((l) => /\[(error|fatal)\]/.test(l))
    .slice(-6);

export const startRecordingSession = (
  o: RecordingSessionOptions
): RecordingSession => {
  const id = randomUUID();
  const t0Ms = o.now();
  const stamp = new Date(t0Ms).toISOString().slice(0, 19).replace(/:/g, "-");
  const dir = path.join(o.folder, `${stamp} ${id.slice(0, 8)}`);
  fs.mkdirSync(dir, { recursive: true });
  const files: RecordingSessionFiles = {
    camera: path.join(dir, FILE_NAMES.camera),
    screen: path.join(dir, FILE_NAMES.screen),
    mic: path.join(dir, FILE_NAMES.mic),
  };
  const eventLog = path.join(dir, EVENT_LOG_NAME);

  let seq = 0;
  const log = (event: Unlogged) => {
    seq += 1;
    const logged = {
      ...event,
      seq,
      recordingSessionId: id,
    } as RecordingSessionEvent;
    fs.appendFileSync(eventLog, `${JSON.stringify(logged)}\n`);
    o.emit(logged);
  };

  const tag = `cvm-recorder-${id}`;
  const args = buildCaptureArgs({
    t0Ms,
    tag,
    screenIndex: o.screenIndex,
    camera: o.camera,
    mic: o.mic,
    silenceLength: o.silenceLength,
  });

  const speech = createSpeechDetector();
  let lastFileTime = 0;
  let stopping = false;
  let ended = false;

  const run = (name: "screen" | "camera", processArgs: string[]) => {
    const ffmpegLog = fs.createWriteStream(
      path.join(dir, `ffmpeg-${name}.log`)
    );
    let tail = "";
    const child = o.launch({ tool: "ffmpeg", args: processArgs, cwd: dir });
    child.onStderr((chunk) => {
      ffmpegLog.write(chunk);
      tail = (tail + chunk).slice(-8192);
    });
    return {
      child,
      errors: () => errorTail(tail),
      closeLog: () => ffmpegLog.end(),
    };
  };

  const screen = run("screen", args.screen);
  const camera = run("camera", args.camera);
  camera.child.onStderr(
    lineSplitter((line) => {
      const change = speech.line(line);
      if (change) log(change);
    })
  );
  // -progress pipe:1: blocks of key=value lines; out_time_us is file time.
  camera.child.onStdout(
    lineSplitter((line) => {
      const m = line.match(/^out_time_us=(\d+)/);
      if (m) lastFileTime = Math.max(lastFileTime, Number(m[1]) / 1e6);
    })
  );

  log({
    type: "recording-started",
    videoId: o.videoId,
    t0Ms,
    silenceLength: o.silenceLength,
    files,
  });

  // ddagrab skips frame slots at Windows' default 15.6 ms timer tick and
  // ffmpeg never raises it; Normal priority and power throttling cost more.
  // A screen recorder left untuned still records, so this only reports.
  void runToEnd(
    o.launch({
      tool: "powershell",
      script: "timer-resolution.ps1",
      args: ["-Tag", tag, "-Match", FILE_NAMES.screen],
    })
  ).then(({ code, stdout, stderr }) => {
    if (ended) return;
    const detail =
      (code === 0 ? stdout : stderr || stdout).trim().split(/\r?\n/)[0] ?? "";
    log({ type: "screen-recorder-tuned", ok: code === 0, detail });
  });

  const quit = (p: LaunchedProcess) => {
    p.writeStdin("q");
    const timer = setTimeout(() => p.kill(), STOP_TIMEOUT_MS);
    void p.exited.then(() => clearTimeout(timer));
  };

  const finished = Promise.all([screen.child.exited, camera.child.exited]);

  const stopWith = (reason: "requested" | "ffmpeg-exited") => {
    if (stopping) return finished.then(() => {});
    stopping = true;
    speech.stopRequested();
    quit(screen.child);
    quit(camera.child);
    return finished.then(([screenCode, cameraCode]) => {
      const last = speech.stop(lastFileTime);
      if (last) log(last);
      log({
        type: "recording-stopped",
        reason,
        fileTime: lastFileTime,
        files,
        exitCodes: { screen: screenCode, camera: cameraCode },
        errors:
          reason === "ffmpeg-exited"
            ? [...screen.errors(), ...camera.errors()]
            : [],
      });
      ended = true;
      screen.closeLog();
      camera.closeLog();
      o.onEnded();
    });
  };

  // A process that quits on its own ends the Recording Session: the other is
  // stopped so its file closes cleanly.
  for (const p of [screen.child, camera.child]) {
    void p.exited.then(() => {
      if (!stopping) void stopWith("ffmpeg-exited");
    });
  }

  return {
    id,
    eventLog,
    lastSeq: () => seq,
    stop: () => stopWith("requested"),
  };
};
