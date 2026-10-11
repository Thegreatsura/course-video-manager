import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { SilenceLength } from "../app/silence-detection-constants";
import { quitProcess } from "./camera";
import { buildCaptureArgs, FILE_NAMES } from "./capture-args";
import {
  lineSplitter,
  runToEnd,
  type LaunchedProcess,
  type Launcher,
} from "./launcher";
import type { Scene } from "../app/packages/scene-layout";
import type { RecordingSessionEvent, RecordingSessionFiles } from "./protocol";
import { repairFile } from "./footage-repair";
import { createSpeechDetector } from "./speech-detector";

/**
 * ONE RECORDING SESSION, start to stop: the two ffmpeg.exe processes, their
 * logs, and the Recording Session's event log. Everything it reports goes
 * through `log`, which numbers it, appends it to `events.jsonl` and only then
 * hands it on, so nothing is sent that a replay could not send again.
 */

/** How long `q` gets to close the files before the process is killed. */
const STOP_TIMEOUT_MS = 20_000;

/**
 * Progress blocks (one a second, `-stats_period 1`) in a row with no new
 * camera frame, once frames have come, before the camera counts as lost.
 * A Cam Link pulled out may leave ffmpeg running on the mic alone.
 */
const CAMERA_STALL_BLOCKS = 3;

export const EVENT_LOG_NAME = "events.jsonl";

/**
 * In each ffmpeg.exe's command line and file metadata, so a process can be
 * found by its Recording Session (timer-resolution.ps1, stop-recorders.ps1).
 */
export const recorderTag = (recordingSessionId: string) =>
  `cvm-recorder-${recordingSessionId}`;

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
  /** The service's camera preview feed, which the camera process sends to. */
  cameraPreviewPort: number;
  /** The scene the Recording Session starts in. */
  scene: Scene;
  /** Each event, after it is in the log. */
  emit: (event: RecordingSessionEvent) => void;
  /** Once, after `recording-stopped`. */
  onEnded: () => void;
};

export type RecordingSession = {
  id: string;
  eventLog: string;
  lastSeq: () => number;
  /** Logs a scene change at the picture time it is asked for. */
  switchScene: (scene: Scene) => void;
  stop: () => Promise<void>;
};

/** The last few error lines a process printed, for why it quit. */
const errorTail = (log: string) =>
  log
    .split(/\r?\n/)
    .filter((l) => /\[(error|fatal)\]/.test(l))
    .slice(-6);

/**
 * The frames a process's ffmpeg counted as duplicated or dropped, from the
 * latest `-progress` block.
 */
const countFramesLost = (p: LaunchedProcess) => {
  let dup = 0;
  let drop = 0;
  p.onStdout(
    lineSplitter((line) => {
      const m = line.match(/^(dup|drop)_frames=(\d+)/);
      if (m?.[1] === "dup") dup = Number(m[2]);
      if (m?.[1] === "drop") drop = Number(m[2]);
    })
  );
  return () => dup + drop;
};

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

  const tag = recorderTag(id);
  const args = buildCaptureArgs({
    t0Ms,
    tag,
    screenIndex: o.screenIndex,
    camera: o.camera,
    mic: o.mic,
    silenceLength: o.silenceLength,
    cameraPreviewPort: o.cameraPreviewPort,
  });

  const speech = createSpeechDetector();
  let lastFileTime = 0;
  let stopping = false;
  let ended = false;

  const run = (name: "screen" | "camera", processArgs: string[]) => {
    const ffmpegLog = fs.createWriteStream(
      path.join(dir, `ffmpeg-${name}.log`)
    );
    // A log that cannot be written must not take the recording down with it.
    ffmpegLog.on("error", (error) =>
      console.error(`recorder: ffmpeg-${name}.log`, error.message)
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
  const screenLost = countFramesLost(screen.child);
  const cameraLostFrames = countFramesLost(camera.child);
  let cameraBufferDrops = 0;
  camera.child.onStderr(
    lineSplitter((line) => {
      if (/real-time buffer .*\[video input\].*frame dropped/.test(line))
        cameraBufferDrops += 1;
    })
  );
  camera.child.onStderr(
    lineSplitter((line) => {
      const change = speech.line(line);
      if (change) log(change);
    })
  );
  // -progress pipe:1: blocks of key=value lines ending `progress=…`;
  // out_time_us is file time, frame the camera's frames written.
  let cameraFrames = 0;
  let framesAtLastBlock = 0;
  let stalledBlocks = 0;
  camera.child.onStdout(
    lineSplitter((line) => {
      const time = line.match(/^out_time_us=(\d+)/);
      if (time) lastFileTime = Math.max(lastFileTime, Number(time[1]) / 1e6);
      const frame = line.match(/^frame=(\d+)/);
      if (frame) cameraFrames = Number(frame[1]);
      if (!line.startsWith("progress=")) return;
      stalledBlocks =
        cameraFrames > 0 && cameraFrames === framesAtLastBlock
          ? stalledBlocks + 1
          : 0;
      framesAtLastBlock = cameraFrames;
      if (stalledBlocks >= CAMERA_STALL_BLOCKS) {
        cameraLost([
          `The Cam Link sent no frames for ${CAMERA_STALL_BLOCKS} s.`,
        ]);
      }
    })
  );

  log({
    type: "recording-started",
    videoId: o.videoId,
    t0Ms,
    silenceLength: o.silenceLength,
    files,
  });
  log({ type: "scene-changed", scene: o.scene, fileTime: 0 });

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

  /** Done once it exited and, if it had to be killed, Windows stopped it too. */
  const quit = (p: LaunchedProcess) =>
    quitProcess(p, { launch: o.launch, tag, timeoutMs: STOP_TIMEOUT_MS });

  const finished = Promise.all([screen.child.exited, camera.child.exited]);

  const stopWith = (
    reason: Extract<
      RecordingSessionEvent,
      { type: "recording-stopped" }
    >["reason"]
  ) => {
    if (stopping) return finished.then(() => {});
    stopping = true;
    speech.stopRequested();
    const quitting = Promise.all([quit(screen.child), quit(camera.child)]);
    return quitting.then(async () => {
      const [screenCode, cameraCode] = await finished;
      // `q` closes every file with its duration. A process that quit on an
      // error or was killed may not have: its files are repaired now, so
      // every file the Recording Session leaves is readable.
      if (screenCode !== 0) await repairFile(o.launch, files.screen);
      if (cameraCode !== 0) {
        await repairFile(o.launch, files.camera);
        await repairFile(o.launch, files.mic);
      }
      const last = speech.stop(lastFileTime);
      if (last) log(last);
      log({
        type: "recording-stopped",
        reason,
        fileTime: lastFileTime,
        files,
        exitCodes: { screen: screenCode, camera: cameraCode },
        framesLost: {
          camera: cameraLostFrames() + cameraBufferDrops,
          screen: screenLost(),
        },
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

  /** The camera went: say so, then stop the whole Recording Session. */
  function cameraLost(errors: string[]) {
    if (stopping) return;
    log({ type: "camera-lost", fileTime: lastFileTime, errors });
    // `recording-stopped` reports the end; nothing else waits on it.
    void stopWith("camera-lost");
  }

  // A process that quits on its own ends the Recording Session: the other is
  // stopped so its file closes cleanly. The camera process quitting means
  // the camera is gone.
  void screen.child.exited.then(() => {
    if (!stopping) void stopWith("ffmpeg-exited");
  });
  void camera.child.exited.then(() => cameraLost(camera.errors()));

  return {
    id,
    eventLog,
    lastSeq: () => seq,
    switchScene: (scene) => {
      if (ended) return;
      // Picture time: the wall clock every process stamps its frames with,
      // less T0 (protocol.ts, TIME BASE).
      log({ type: "scene-changed", scene, fileTime: (o.now() - t0Ms) / 1000 });
    },
    stop: () => stopWith("requested"),
  };
};
