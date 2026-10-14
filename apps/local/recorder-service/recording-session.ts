import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { finished as streamFinished } from "node:stream/promises";
import type { SilenceLength } from "../app/silence-detection-constants";
import { quitProcess, type Capture } from "./camera";
import { FILE_NAMES } from "./capture-args";
import {
  cameraWriterArgs,
  screenRecorderArgs,
  takeStartCommand,
  WRITER_STATS_PERIOD,
} from "./take-args";
import {
  lineSplitter,
  runToEnd,
  type LaunchedProcess,
  type Launcher,
} from "./launcher";
import type { VideoFormat } from "@/features/videos/video-format";
import type { Scene } from "../app/packages/scene-layout";
import type { RecordingSessionEvent, RecordingSessionFiles } from "./protocol";
import { repairFile } from "./footage-repair";
import { createSpeechDetector } from "./speech-detector";

/**
 * ONE RECORDING SESSION (#2207). Its camera + mic writer is armed before
 * Record (`armTake`): listening on the camera capture's writer relay,
 * dropping every frame. Record (`begin`) tells it T0, and starts the screen
 * recorder; Stop quits both. The devices stay open throughout, in the
 * capture, and the preview never notices. Everything it reports goes
 * through `log`, which numbers it, appends it to `events.jsonl` and only then
 * hands it on, so nothing is sent that a replay could not send again.
 */

/** How long `q` gets to close the files before the process is killed. */
const STOP_TIMEOUT_MS = 20_000;

/**
 * Stop waits this long before it quits the writer: frames already captured
 * but still on their way through the relay reach the file, so it keeps
 * everything up to the press.
 */
export const STOP_TAIL_MS = 250;

/**
 * Seconds with no new camera frame written, once frames have come, before
 * the camera counts as lost. A Cam Link pulled out may leave the capture
 * running on the mic alone.
 */
const CAMERA_STALL_SECONDS = 3;

/** The writer's -progress blocks in that time (one every `WRITER_STATS_PERIOD`). */
export const CAMERA_STALL_BLOCKS = Math.round(
  CAMERA_STALL_SECONDS / WRITER_STATS_PERIOD
);

/** The Cam Link's frame rate: how many frames a gap the writer logs was. */
const CAMERA_FPS = 30000 / 1001;

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

/** What a writer is armed with: a Record that asks for anything else arms another. */
export type TakeSettings = {
  /** The folder (WSL path) the Recording Session's own folder goes in. */
  folder: string;
  silenceLength: SilenceLength;
  /** The silence threshold its silencedetect cuts with, in dB. */
  thresholdDb: number;
  /** The camera capture's writer relay it listens on. */
  relayPort: number;
};

export const sameTake = (a: TakeSettings, b: TakeSettings) =>
  a.folder === b.folder &&
  a.silenceLength === b.silenceLength &&
  a.thresholdDb === b.thresholdDb &&
  a.relayPort === b.relayPort;

export type BeginOptions = {
  videoId: string;
  /** The AV Calibration that set it; null: none had passed. */
  avCalibrationId: string | null;
  /** The live camera capture the writer reads. */
  capture: Capture;
  /** ddagrab's output_idx for the screen; null records camera and mic only. */
  screenIndex: number | null;
  /** The Video's format, logged in `recording-started`. */
  format: VideoFormat;
  /**
   * How long after Record the first camera frame may take to be written
   * before the camera counts as lost.
   */
  cameraStartTimeoutMs: number;
  /** The scene the Recording Session starts in. */
  scene: Scene;
  /** Each event, after it is in the log. */
  emit: (event: RecordingSessionEvent) => void;
  /** Once, after `recording-stopped`. */
  onEnded: () => void;
};

export type ArmedTake = {
  settings: TakeSettings;
  /** Resolves once the writer reads the relay; rejects if it quits first. */
  ready: Promise<void>;
  /** Starts the take now: T0 is this moment. */
  begin: (o: BeginOptions) => RecordingSession;
  /** Quits a writer that never began, and removes its folder. */
  disarm: () => Promise<void>;
};

export type RecordingSession = {
  id: string;
  eventLog: string;
  t0Ms: number;
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

/** An error line about the Cam Link, from the capture: dshow naming its video input. */
const namesCamera = (line: string) =>
  /\bin#0\b|\[video input\]|video=/.test(line);

/** What the writer prints once it has the relay: its input opened. */
const READS_RELAY = /Input #0, nut, from 'tcp:/;

/** A gap the writer logged, in seconds (`FRAME_GAP_SECONDS`). */
const GAP = /\[warning\] -(\d+(?:\.\d+)?)\s*$/;

/**
 * Arms a take: makes its folder, and starts its camera + mic writer on the
 * capture's writer relay. `onQuit` hears of a writer that quits before it
 * began (its folder is removed).
 */
export const armTake = (o: {
  launch: Launcher;
  /** Windows wall-clock ms: the clock ffmpeg stamps every input with. */
  now: () => number;
  settings: TakeSettings;
  onQuit: (errors: string[]) => void;
}): ArmedTake => {
  const id = randomUUID();
  const stamp = new Date(o.now()).toISOString().slice(0, 19).replace(/:/g, "-");
  const dir = path.join(o.settings.folder, `${stamp} ${id.slice(0, 8)}`);
  fs.mkdirSync(dir, { recursive: true });
  const tag = recorderTag(id);

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
      /**
       * Done once the log is on disk and closed. The stream opens and writes
       * on libuv's threadpool, so without this its file could be created or
       * written after the Recording Session says it stopped. A log that
       * failed is done too: it was already reported.
       */
      closeLog: () => {
        ffmpegLog.end();
        return streamFinished(ffmpegLog).catch(() => {});
      },
    };
  };

  const camera = run(
    "camera",
    cameraWriterArgs({
      relayPort: o.settings.relayPort,
      tag,
      silenceLength: o.settings.silenceLength,
      thresholdDb: o.settings.thresholdDb,
    })
  );
  let begun = false;
  let disarmed = false;
  const removeDir = async () => {
    await camera.closeLog();
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (e) {
      console.error(`recorder: could not remove ${dir}`, e);
    }
  };
  const ready = new Promise<void>((resolve, reject) => {
    camera.child.onStderr(
      lineSplitter((line) => {
        if (READS_RELAY.test(line)) resolve();
      })
    );
    void camera.child.exited.then(() =>
      reject(new Error(camera.errors().join(" ") || "The writer quit."))
    );
  });
  // Nobody may be waiting on it; a quit is told through `onQuit`.
  ready.catch(() => {});
  void camera.child.exited.then(async () => {
    if (begun || disarmed) return;
    await removeDir();
    o.onQuit(camera.errors());
  });

  return {
    settings: o.settings,
    ready,
    disarm: async () => {
      if (begun || disarmed) return;
      disarmed = true;
      await quitProcess(camera.child, {
        launch: o.launch,
        tag,
        timeoutMs: STOP_TIMEOUT_MS,
      });
      await removeDir();
    },
    begin: (b) => {
      if (begun || disarmed) throw new Error("This take was already used.");
      begun = true;
      return beginTake({
        ...b,
        id,
        dir,
        tag,
        launch: o.launch,
        now: o.now,
        settings: o.settings,
        camera,
        run,
      });
    },
  };
};

const beginTake = (
  o: BeginOptions & {
    id: string;
    dir: string;
    tag: string;
    launch: Launcher;
    now: () => number;
    settings: TakeSettings;
    camera: {
      child: LaunchedProcess;
      errors: () => string[];
      closeLog: () => Promise<void>;
    };
    run: (
      name: "screen" | "camera",
      args: string[]
    ) => {
      child: LaunchedProcess;
      errors: () => string[];
      closeLog: () => Promise<void>;
    };
  }
): RecordingSession => {
  const { id, dir, tag, camera } = o;
  const t0Ms = o.now();
  // T0 first: everything else waits on it.
  camera.child.writeStdin(takeStartCommand(t0Ms));
  const files: RecordingSessionFiles = {
    camera: path.join(dir, FILE_NAMES.camera),
    screen: path.join(dir, FILE_NAMES.screen),
    mic: path.join(dir, FILE_NAMES.mic),
  };
  const eventLog = path.join(dir, EVENT_LOG_NAME);

  let seq = 0;
  /** Why the event log could not be written, once it could not. */
  let logFailure: string | undefined;
  // `log` runs inside ffmpeg's stderr listener and promise callbacks, where a
  // throw would kill the service and leave ffmpeg.exe recording. A failed
  // append (a full or missing drive) stops the Recording Session instead.
  const log = (event: Unlogged) => {
    seq += 1;
    const logged = {
      ...event,
      seq,
      recordingSessionId: id,
    } as RecordingSessionEvent;
    try {
      fs.appendFileSync(eventLog, `${JSON.stringify(logged)}\n`);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error(`recorder: could not write ${eventLog}`, e);
      if (!logFailure) {
        logFailure = `Could not write the event log: ${message}`;
        // `recording-stopped` reports the failure; nothing else waits on it.
        void stopWith("event-log-failed");
      }
    }
    // Still sent: a live client should hear that speech, and the stop.
    o.emit(logged);
  };

  const speech = createSpeechDetector();
  let lastFileTime = 0;
  let stopping = false;
  let ended = false;

  const screen =
    o.screenIndex === null
      ? null
      : o.run(
          "screen",
          screenRecorderArgs({ t0Ms, tag, screenIndex: o.screenIndex })
        );

  // The capture's own log for the take: its mic stalls and DirectShow's
  // dropped frames, beside the files.
  const captureLog = fs.createWriteStream(path.join(dir, "ffmpeg-capture.log"));
  captureLog.on("error", (error) =>
    console.error("recorder: ffmpeg-capture.log", error.message)
  );
  // FRAMES LOST. The Cam Link's dshow buffer drops, and any gap in the
  // frames reaching the writer (the Cam Link skipping, or the relay dropping
  // what the writer could not take). The screen's loss is not measured
  // (null) rather than a 0 that hides it: the fps filter fills its gaps.
  let cameraBufferDrops = 0;
  let cameraGapFrames = 0;
  const stopCaptureLines = o.capture.onLine((line) => {
    captureLog.write(`${line}\n`);
    if (/real-time buffer .*\[video input\].*frame dropped/.test(line))
      cameraBufferDrops += 1;
  });
  camera.child.onStderr(
    lineSplitter((line) => {
      const gap = line.match(GAP);
      if (gap) {
        const missing = Math.max(
          1,
          Math.round(Number(gap[1]) * CAMERA_FPS) - 1
        );
        cameraGapFrames += missing;
        console.error(
          `recorder: camera.mkv is missing about ${missing} frame(s) at ${lastFileTime.toFixed(1)} s: a ${gap[1]} s gap in the Cam Link's frames reaching the writer`
        );
        return;
      }
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
      if (ended) return;
      const time = line.match(/^out_time_us=(\d+)/);
      if (time) lastFileTime = Math.max(lastFileTime, Number(time[1]) / 1e6);
      const frame = line.match(/^frame=(\d+)/);
      if (frame) cameraFrames = Number(frame[1]);
      if (cameraFrames > 0) clearTimeout(cameraStart);
      if (!line.startsWith("progress=")) return;
      stalledBlocks =
        cameraFrames > 0 && cameraFrames === framesAtLastBlock
          ? stalledBlocks + 1
          : 0;
      framesAtLastBlock = cameraFrames;
      if (stalledBlocks >= CAMERA_STALL_BLOCKS) {
        cameraLost([
          `The Cam Link sent no frames for ${CAMERA_STALL_SECONDS} s.`,
        ]);
      }
    })
  );

  // A writer that never gets a frame prints no frame count at all, so its
  // first frame is waited for on the wall clock.
  const cameraStart = setTimeout(
    () => cameraLost(["The Cam Link sent nothing after Record."]),
    o.cameraStartTimeoutMs
  );

  log({
    type: "recording-started",
    videoId: o.videoId,
    t0Ms,
    silenceLength: o.settings.silenceLength,
    files,
    format: o.format,
    screenCaptured: screen !== null,
    thresholdDb: o.settings.thresholdDb,
    avCalibrationId: o.avCalibrationId,
    devices: o.capture.devices,
  });
  log({ type: "scene-changed", scene: o.scene, fileTime: 0 });

  // ddagrab skips frame slots at Windows' default 15.6 ms timer tick and
  // ffmpeg never raises it; Normal priority and power throttling cost more.
  // A screen recorder left untuned still records, so this only reports.
  // Without a screen recorder there is nothing to tune.
  if (screen)
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

  const finished = Promise.all([
    screen ? screen.child.exited : null,
    camera.child.exited,
  ]);

  /** The one stop, whoever asked first: done once `recording-stopped` is logged. */
  let stopped: Promise<void> | undefined;
  const stopWith = (
    reason: Extract<
      RecordingSessionEvent,
      { type: "recording-stopped" }
    >["reason"]
  ): Promise<void> => {
    // A second stop (the service closing during a camera-lost stop) waits
    // for the whole first one, not just the processes' exits.
    if (stopped) return stopped;
    stopping = true;
    clearTimeout(cameraStart);
    speech.stopRequested();
    // On request, the frames still on their way through the relay are
    // waited for; a failure stops at once.
    const tail =
      reason === "requested"
        ? new Promise((r) => setTimeout(r, STOP_TAIL_MS))
        : Promise.resolve();
    const quitting = tail.then(() =>
      Promise.all([screen && quit(screen.child), quit(camera.child)])
    );
    stopped = quitting.then(async () => {
      const [screenCode, cameraCode] = await finished;
      stopCaptureLines();
      // `q` closes every file with its duration. A process that quit on an
      // error or was killed may not have: its files are repaired now, so
      // every file the Recording Session leaves is readable.
      if (screen && screenCode !== 0) await repairFile(o.launch, files.screen);
      if (cameraCode !== 0) {
        await repairFile(o.launch, files.camera);
        await repairFile(o.launch, files.mic);
      }
      // Every file closed before the stop is told: a client hearing
      // `recording-stopped` may move or remove the folder at once.
      captureLog.end();
      await Promise.all([
        screen?.closeLog(),
        camera.closeLog(),
        streamFinished(captureLog).catch(() => {}),
      ]);
      const last = speech.stop(lastFileTime);
      if (last) log(last);
      const captureErrors = o.capture.quitWith() ?? [];
      log({
        type: "recording-stopped",
        reason,
        fileTime: lastFileTime,
        files,
        exitCodes: { screen: screenCode, camera: cameraCode },
        framesLost: {
          camera: cameraBufferDrops + cameraGapFrames,
          screen: null,
        },
        errors: [
          ...(logFailure ? [logFailure] : []),
          ...(cameraGapFrames > 0
            ? [
                `camera.mkv is missing about ${cameraGapFrames} frame(s): gaps in the Cam Link's frames reaching the writer (ffmpeg-camera.log).`,
              ]
            : []),
          ...(reason === "ffmpeg-exited"
            ? [
                ...(screen?.errors() ?? []),
                ...camera.errors(),
                ...captureErrors,
              ]
            : []),
        ],
      });
      ended = true;
      o.onEnded();
    });
    return stopped;
  };

  /** The camera went: say so, then stop the whole Recording Session. */
  function cameraLost(errors: string[]) {
    if (stopping) return;
    log({ type: "camera-lost", fileTime: lastFileTime, errors });
    // `recording-stopped` reports the end; nothing else waits on it.
    void stopWith("camera-lost");
  }

  // A process that quits on its own ends the Recording Session: the other is
  // stopped so its file closes cleanly. The writer quitting is the camera
  // lost when the capture went with errors naming the Cam Link; a mic, disk
  // or writer failure is reported as itself.
  void screen?.child.exited.then(() => {
    if (!stopping) void stopWith("ffmpeg-exited");
  });
  void camera.child.exited.then(() => {
    if (stopping) return;
    const captureErrors = o.capture.quitWith();
    if (captureErrors?.some(namesCamera)) cameraLost(captureErrors);
    else void stopWith("ffmpeg-exited");
  });

  return {
    id,
    eventLog,
    t0Ms,
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
