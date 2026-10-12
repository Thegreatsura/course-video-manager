import { Either, Schema } from "effect";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { WebSocket, WebSocketServer } from "ws";
import { corsHeaders, isAllowedOrigin } from "./allowed-origin";
import {
  readJsonLines,
  recoverCrashedSessions,
  type IndexEntry,
} from "./crash-recovery";
import { CAMERA_START_TIMEOUT_MS, openCamera, type Camera } from "./camera";
import type { Launcher } from "./launcher";
import type { VideoFormat } from "@/features/videos/video-format";
import {
  DEFAULT_SCENE,
  SCENES,
  type Scene,
} from "../app/packages/scene-layout";
import { startPreviewFeeds } from "./preview-feeds";
import {
  STILL_NO_PICTURE,
  STILL_PATH,
  STILL_RECORDER_CLOSED,
  STILL_WHILE_RECORDING,
  RECENT_SESSIONS,
  type CameraStatus,
  type RecorderCommand,
  type RecorderMessage,
  type RecorderState,
  type RecordingSessionEvent,
  type StreamDeckPress,
} from "./protocol";
import {
  startRecordingSession,
  type RecordingSession,
} from "./recording-session";
import {
  checkFfmpeg,
  checkNvidiaDriver,
  listDshowDevices,
} from "./windows-devices";
import { findByName, Refusal } from "./refusal";
import { createScreenSide, refuseScreenlessScene } from "./screen-side";

/**
 * THE RECORDER SERVICE (ADR 0034): a long-running process of its own in WSL
 * that records camera, screen and mic for one Video at a time, through
 * ffmpeg.exe on Windows. It never touches the database. Its interface is one
 * WebSocket (`protocol.ts`); its durable record is each Recording Session's
 * `events.jsonl`, beside the Footage.
 *
 * Commands are handled one at a time, in the order they arrive, so a `stop`
 * can never overtake the `record` it stops.
 *
 * It holds the Cam Link only while the recorder is open for a Video: opening
 * opens it (`camera.ts`) and the screen preview; Record is refused until the
 * camera is live; Record hands the Cam Link from the preview process to the
 * recording, and the end of the recording hands it back; closing lets it go.
 *
 * The screen depends on the Video's format. Landscape records the DELL,
 * checked at Record. A Short records the Spacedesk virtual display: opening
 * looks for it and wakes Spacedesk when it is not listed, beside the camera
 * and outside the command queue, and the state says how that went
 * (`ScreenStatus`, `screen-side.ts`). With it unavailable a Short records camera and mic only,
 * and refuses the scenes that draw the screen.
 */

/** The devices the rig proved, found by name. */
export const CAMERA_NAME = "Cam Link 4K";
export const MIC_NAME = "Voicemeeter Out B1";

/** A still older than this is not the camera now: the preview process stalled or quit. */
const STILL_MAX_AGE_MS = 2_000;

export type RecorderServiceOptions = {
  /** 0 picks a free port (tests). */
  port: number;
  launch: Launcher;
  /** Windows wall-clock ms: the clock ffmpeg stamps every input with. */
  now: () => number;
  /** The service's own files: the last NVIDIA driver seen, the Recording Session index. */
  stateDir: string;
  /** How long one try at the Cam Link waits for its first frame. */
  cameraStartTimeoutMs?: number;
  /**
   * Wakes the Spacedesk display (`app/spacedesk-wake.ts`); rejects with a
   * message that says why it could not.
   */
  wakeSpacedesk: () => Promise<void>;
};

const FORMATS = ["landscape", "short"] as const satisfies VideoFormat[];

const Command = Schema.Union(
  Schema.Struct({
    type: Schema.Literal("open"),
    videoId: Schema.String,
    format: Schema.optional(Schema.Literal(...FORMATS)),
  }),
  Schema.Struct({
    type: Schema.Literal("record"),
    silenceLength: Schema.Literal("short", "long"),
    folder: Schema.String,
  }),
  Schema.Struct({ type: Schema.Literal("stop") }),
  Schema.Struct({ type: Schema.Literal("close") }),
  Schema.Struct({ type: Schema.Literal("retry-camera") }),
  Schema.Struct({ type: Schema.Literal("retry-screen") }),
  Schema.Struct({
    type: Schema.Literal("switch-scene"),
    scene: Schema.Literal(...SCENES),
  }),
  Schema.Struct({
    type: Schema.Literal("prepare-record"),
    videoId: Schema.String,
    silenceLength: Schema.Literal("short", "long"),
    folder: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("stream-deck"),
    press: Schema.Union(
      Schema.Struct({ action: Schema.Literal("record", "stop") }),
      Schema.Struct({
        action: Schema.Literal("switch-scene"),
        scene: Schema.Literal(...SCENES),
      })
    ),
  }),
  Schema.Struct({
    type: Schema.Literal("replay"),
    recordingSessionId: Schema.String,
    afterSeq: Schema.Number,
  })
);
const decodeCommand = Schema.decodeUnknownEither(Schema.parseJson(Command));

export const startRecorderService = async (o: RecorderServiceOptions) => {
  const ffmpeg = await checkFfmpeg(o.launch);
  const warnings: string[] = [];
  if (ffmpeg.ok) {
    const driver = await checkNvidiaDriver(o.launch, o.stateDir);
    if (driver) warnings.push(driver);
  }

  const indexFile = path.join(o.stateDir, "recording-sessions.jsonl");
  fs.mkdirSync(o.stateDir, { recursive: true });
  /** Every Recording Session the service has started, oldest first. */
  const readIndex = (): IndexEntry[] =>
    fs.existsSync(indexFile) ? readJsonLines<IndexEntry>(indexFile) : [];
  /** Where a Recording Session's event log is, from the index the service keeps. */
  const eventLogOf = (recordingSessionId: string) =>
    readIndex().find((e) => e.recordingSessionId === recordingSessionId)
      ?.eventLog;

  let state: RecorderState = { kind: "closed" };
  /** The scene the picture is drawn in; kept while the service runs. */
  let scene: Scene = DEFAULT_SCENE;
  /** What a Stream Deck Record records with, from the app server. */
  let recordWith:
    Extract<RecorderCommand, { type: "prepare-record" }> | undefined;
  let listening: () => void = () => {};
  let session: RecordingSession | undefined;
  let camera: Camera | undefined;
  const feeds = await startPreviewFeeds();

  /** `GET /still`: the camera's latest still, or why there is none. */
  const serveStill = (req: http.IncomingMessage, res: http.ServerResponse) => {
    const headers = {
      "Cache-Control": "no-store",
      ...corsHeaders(req.headers.origin),
    };
    const still = feeds.latest("still");
    const refusal =
      state.kind === "closed"
        ? STILL_RECORDER_CLOSED
        : state.kind === "recording"
          ? STILL_WHILE_RECORDING
          : state.camera.kind !== "live" ||
              !still ||
              Date.now() - still.atMs > STILL_MAX_AGE_MS
            ? STILL_NO_PICTURE
            : undefined;
    if (refusal || !still) {
      res.writeHead(state.kind === "open" ? 503 : 409, {
        ...headers,
        "Content-Type": "text/plain; charset=utf-8",
      });
      res.end(refusal);
      return;
    }
    res.writeHead(200, { ...headers, "Content-Type": "image/jpeg" });
    res.end(still.jpeg);
  };

  const server = http.createServer((req, res) => {
    if (!isAllowedOrigin(req.headers.origin)) {
      res.writeHead(403, { Vary: "Origin" }).end();
      return;
    }
    if (feeds.serve(req, res, corsHeaders(req.headers.origin))) return;
    if (req.method === "GET" && req.url === STILL_PATH)
      return serveStill(req, res);
    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ service: "recorder", pid: process.pid, state }));
      return;
    }
    res.writeHead(404).end();
  });
  const wss = new WebSocketServer({
    server,
    verifyClient: ({ origin }: { origin?: string }) =>
      isAllowedOrigin(origin || undefined),
  });
  // An error event nobody listens for kills the process, and with it the
  // only thing that can send ffmpeg.exe its `q`. No client may do that.
  wss.on("error", (e) => console.error("recorder: WebSocket server error", e));
  const send = (ws: WebSocket, message: RecorderMessage) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
  };
  const broadcast = (message: RecorderMessage) => {
    for (const ws of wss.clients) send(ws, message);
  };
  const setState = (next: RecorderState) => {
    state = next;
    broadcast({ type: "state", state });
  };

  const findCamera = async () => {
    const { devices } = await listDshowDevices(o.launch);
    return findByName(
      devices.filter((d) => d.kind === "video").map((d) => d.name),
      (n) => n,
      CAMERA_NAME
    );
  };

  /** Opens the Cam Link for the open recorder; its status goes in the state. */
  const startCamera = (): CameraStatus => {
    camera = openCamera({
      launch: o.launch,
      feeds,
      findCamera,
      startTimeoutMs: o.cameraStartTimeoutMs ?? CAMERA_START_TIMEOUT_MS,
      onStatus: (status) => {
        if (state.kind === "open") setState({ ...state, camera: status });
      },
    });
    return camera.status();
  };

  const releaseCamera = async () => {
    const released = camera;
    camera = undefined;
    await released?.release();
  };

  const screenSide = createScreenSide({
    launch: o.launch,
    previewPort: () => feeds.port("screen"),
    wakeSpacedesk: o.wakeSpacedesk,
    format: () => (state.kind === "closed" ? undefined : state.format),
    setStatus: (screen) => {
      if (state.kind !== "closed" && state.format === "short")
        setState({ ...state, screen });
    },
  });

  const onEvent = (event: RecordingSessionEvent) => {
    if (state.kind === "recording") state = { ...state, lastSeq: event.seq };
    broadcast(event);
  };

  const screenStatus = () => (state.kind === "closed" ? null : state.screen);

  /** Open again after a Recording Session, with the camera back in the preview. */
  const reopen = (videoId: string) => {
    if (state.kind === "closed") return;
    setState({
      kind: "open",
      videoId,
      format: state.format,
      scene,
      screen: state.screen,
      camera: startCamera(),
    });
  };

  const record = async (
    command: Extract<RecorderCommand, { type: "record" }>
  ) => {
    if (state.kind === "closed")
      throw new Refusal("Open the recorder for a Video first.");
    if (state.kind === "recording") throw new Refusal("Already recording.");
    if (state.camera.kind !== "live")
      throw new Refusal("The camera is not live yet.");
    if (!path.isAbsolute(command.folder)) {
      throw new Refusal(
        `The folder must be an absolute path: ${command.folder}`
      );
    }
    const { devices, raw } = await listDshowDevices(o.launch);
    const names = (kind: "video" | "audio") =>
      devices.filter((d) => d.kind === kind).map((d) => d.name);
    const camera = findByName(names("video"), (n) => n, CAMERA_NAME);
    const mic = findByName(names("audio"), (n) => n, MIC_NAME);
    if (!camera || !mic) {
      const missing = !camera
        ? `${CAMERA_NAME} (video)`
        : `${MIC_NAME} (audio)`;
      throw new Refusal(
        `${missing} is not among the DirectShow devices. Found: ${devices.map((d) => `${d.name} (${d.kind})`).join(", ") || `none. ffmpeg said: ${raw.slice(0, 500)}`}`
      );
    }
    const { videoId, format } = state;
    const screenIndex = await screenSide.recordIndex(
      format,
      state.screen,
      scene
    );
    // The Cam Link opens in one process at a time: the recording's takes it
    // over from the preview, and hands it back when it ends.
    await releaseCamera();
    try {
      session = startRecordingSession({
        launch: o.launch,
        now: o.now,
        videoId,
        folder: command.folder,
        silenceLength: command.silenceLength,
        camera,
        mic,
        screenIndex,
        format,
        cameraPreviewPort: feeds.port("camera"),
        cameraStartTimeoutMs: o.cameraStartTimeoutMs ?? CAMERA_START_TIMEOUT_MS,
        scene,
        emit: onEvent,
        onEnded: () => {
          session = undefined;
          reopen(videoId);
        },
      });
    } catch (e) {
      reopen(videoId);
      throw e;
    }
    // The session is already recording: a failed index write must not turn
    // into a refusal that leaves it running unseen. It only costs replay.
    try {
      fs.appendFileSync(
        indexFile,
        `${JSON.stringify({ recordingSessionId: session.id, eventLog: session.eventLog })}\n`
      );
    } catch (e) {
      console.error("recorder: could not index the Recording Session", e);
    }
    setState({
      kind: "recording",
      videoId,
      format,
      scene,
      screen: screenStatus(),
      recordingSessionId: session.id,
      lastSeq: session.lastSeq(),
    });
  };

  const replay = (
    ws: WebSocket,
    recordingSessionId: string,
    afterSeq: number
  ) => {
    const eventLog = eventLogOf(recordingSessionId);
    if (!eventLog || !fs.existsSync(eventLog)) {
      throw new Refusal(
        `No event log for Recording Session ${recordingSessionId}.`
      );
    }
    let lastSeq = 0;
    for (const event of readJsonLines<RecordingSessionEvent>(eventLog)) {
      lastSeq = Math.max(lastSeq, event.seq);
      if (event.seq > afterSeq) send(ws, event);
    }
    send(ws, { type: "replay-done", recordingSessionId, lastSeq });
  };

  /** A Stream Deck button: acts on whichever Video the recorder is open for. */
  const press = async (ws: WebSocket, p: StreamDeckPress): Promise<void> => {
    if (state.kind === "closed")
      throw new Refusal(
        "The recorder is not open: open the editor on a CVM recorder Video first."
      );
    switch (p.action) {
      case "record":
        if (recordWith?.videoId !== state.videoId)
          throw new Refusal(
            "The editor has not said its Silence Length yet: press Record in the editor."
          );
        return record({
          type: "record",
          silenceLength: recordWith.silenceLength,
          folder: recordWith.folder,
        });
      case "stop":
        return handle(ws, { type: "stop" });
      case "switch-scene":
        return handle(ws, { type: "switch-scene", scene: p.scene });
    }
  };

  const handle = async (
    ws: WebSocket,
    command: RecorderCommand
  ): Promise<void> => {
    if (command.type === "replay") {
      return replay(ws, command.recordingSessionId, command.afterSeq);
    }
    if (!ffmpeg.ok) throw new Refusal(ffmpeg.message);
    switch (command.type) {
      case "open": {
        if (state.kind === "recording") {
          throw new Refusal(
            "Stop recording before opening the recorder for another Video."
          );
        }
        const format = command.format ?? "landscape";
        const screen = format === "short" ? { kind: "waking" as const } : null;
        if (state.kind === "open") {
          if (state.format === format)
            return setState({ ...state, videoId: command.videoId });
          setState({ ...state, videoId: command.videoId, format, screen });
          return void screenSide.restart();
        }
        setState({
          kind: "open",
          videoId: command.videoId,
          format,
          camera: startCamera(),
          scene,
          screen,
        });
        return void screenSide.restart();
      }
      case "retry-camera":
        if (state.kind !== "open" || !camera?.retry())
          throw new Refusal("The camera is not waiting for a retry.");
        return;
      case "retry-screen":
        if (state.kind === "recording")
          throw new Refusal("Stop recording before waking Spacedesk again.");
        if (state.kind !== "open" || state.format !== "short")
          throw new Refusal("The recorder is not open for a Short.");
        if (state.screen?.kind === "waking")
          throw new Refusal("Spacedesk is already waking.");
        return void screenSide.restart();
      case "switch-scene":
        if (state.kind === "closed")
          throw new Refusal("Open the recorder for a Video first.");
        refuseScreenlessScene(command.scene, state.format, state.screen);
        // While recording, logged first: a clock that cannot be read refuses
        // the switch rather than showing a scene the Footage never got.
        session?.switchScene(command.scene);
        scene = command.scene;
        return setState({ ...state, scene });
      case "record":
        return record(command);
      case "stop":
        if (!session) throw new Refusal("Not recording.");
        return session.stop();
      case "prepare-record":
        recordWith = command;
        return;
      case "stream-deck":
        // Whatever the reason, the press does nothing; every client hears why.
        return press(ws, command.press).catch((e: unknown) => {
          if (!(e instanceof Refusal))
            console.error("recorder: a Stream Deck press failed", e);
          const message = e instanceof Error ? e.message : String(e);
          broadcast({
            type: "stream-deck-ignored",
            press: command.press,
            message,
          });
        });
      case "close":
        if (state.kind === "recording")
          throw new Refusal("Stop recording before closing the recorder.");
        recordWith = undefined;
        if (state.kind === "closed") return setState(state);
        setState({ kind: "closed" });
        await Promise.all([releaseCamera(), screenSide.close()]);
        return;
    }
  };

  let recovered: string[] = [];
  const recentSessions = () => {
    try {
      return readIndex()
        .slice(-RECENT_SESSIONS)
        .map((e) => e.recordingSessionId);
    } catch (e) {
      console.error("recorder: could not read the Recording Session index", e);
      return [];
    }
  };
  // Crash recovery runs before any command and any greeting, so a client
  // hears of every Recording Session it repaired. Only once listening: a
  // second service that cannot take the port must not touch the files.
  let queue: Promise<void> = Promise.resolve();
  const recovering = new Promise<void>((resolve) => {
    listening = resolve;
  }).then(async () => {
    if (!ffmpeg.ok) return;
    try {
      recovered = await recoverCrashedSessions({
        launch: o.launch,
        index: readIndex(),
      });
    } catch (e) {
      console.error("recorder: crash recovery failed", e);
    }
  });
  queue = recovering;
  wss.on("connection", (ws) => {
    // ws raises a client's protocol violation (an unmasked or oversized
    // frame, bad UTF-8) on its socket: drop that client, keep recording.
    ws.on("error", (e) => {
      console.error("recorder: dropping a client that broke the protocol", e);
      ws.terminate();
    });
    void recovering.then(() =>
      send(ws, {
        type: "hello",
        ffmpeg,
        warnings,
        state,
        recovered,
        recent: recentSessions(),
      })
    );
    ws.on("message", (data) => {
      const decoded = decodeCommand(data.toString());
      if (Either.isLeft(decoded)) {
        console.error(
          `recorder: unreadable command ${data.toString().slice(0, 200)}`
        );
        return;
      }
      const command = decoded.right;
      queue = queue.then(async () => {
        try {
          await handle(ws, command);
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          if (!(e instanceof Refusal))
            console.error(`recorder: ${command.type} failed`, e);
          send(ws, { type: "refused", command: command.type, message });
        }
      });
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(o.port, "127.0.0.1", () => resolve());
  });
  listening();

  return {
    port: (server.address() as AddressInfo).port,
    /** Stops a recording cleanly, then closes every socket. */
    close: async () => {
      await queue;
      if (session) await session.stop();
      await Promise.all([releaseCamera(), screenSide.close()]);
      await feeds.close();
      for (const ws of wss.clients) ws.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
};
