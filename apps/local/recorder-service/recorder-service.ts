import { Either, Schema } from "effect";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { WebSocket, WebSocketServer } from "ws";
import { recoverCrashedSessions, type IndexEntry } from "./crash-recovery";
import type { Launcher } from "./launcher";
import type {
  RecorderCommand,
  RecorderMessage,
  RecorderState,
  RecordingSessionEvent,
} from "./protocol";
import {
  startRecordingSession,
  type RecordingSession,
} from "./recording-session";
import {
  checkFfmpeg,
  checkNvidiaDriver,
  listDshowDevices,
  listScreens,
} from "./windows-devices";

/**
 * THE RECORDER SERVICE (ADR 0034): a long-running process of its own in WSL
 * that records camera, screen and mic for one Video at a time, through
 * ffmpeg.exe on Windows. It never touches the database. Its interface is one
 * WebSocket (`protocol.ts`); its durable record is each Recording Session's
 * `events.jsonl`, beside the Footage.
 *
 * Commands are handled one at a time, in the order they arrive, so a `stop`
 * can never overtake the `record` it stops.
 */

/** The devices the rig proved, found by name. */
export const CAMERA_NAME = "Cam Link 4K";
export const MIC_NAME = "Voicemeeter Out B1";
export const SCREEN_NAME = "DELL U2424H";

export type RecorderServiceOptions = {
  /** 0 picks a free port (tests). */
  port: number;
  launch: Launcher;
  /** Windows wall-clock ms: the clock ffmpeg stamps every input with. */
  now: () => number;
  /** The service's own files: the last NVIDIA driver seen, the Recording Session index. */
  stateDir: string;
};

const Command = Schema.Union(
  Schema.Struct({ type: Schema.Literal("open"), videoId: Schema.String }),
  Schema.Struct({
    type: Schema.Literal("record"),
    silenceLength: Schema.Literal("short", "long"),
    folder: Schema.String,
  }),
  Schema.Struct({ type: Schema.Literal("stop") }),
  Schema.Struct({ type: Schema.Literal("close") }),
  Schema.Struct({
    type: Schema.Literal("replay"),
    recordingSessionId: Schema.String,
    afterSeq: Schema.Number,
  })
);
const decodeCommand = Schema.decodeUnknownEither(Schema.parseJson(Command));

class Refusal extends Error {}

const findByName = <T>(items: T[], name: (t: T) => string, wanted: string) =>
  items.find((t) => name(t).toLowerCase().includes(wanted.toLowerCase()));

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
    fs.existsSync(indexFile)
      ? fs
          .readFileSync(indexFile, "utf8")
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line) as IndexEntry)
      : [];
  /** Where a Recording Session's event log is, from the index the service keeps. */
  const eventLogOf = (recordingSessionId: string) =>
    readIndex().find((e) => e.recordingSessionId === recordingSessionId)
      ?.eventLog;

  let state: RecorderState = { kind: "closed" };
  let listening: () => void = () => {};
  let session: RecordingSession | undefined;

  const server = http.createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ service: "recorder", pid: process.pid, state }));
      return;
    }
    res.writeHead(404).end();
  });
  const wss = new WebSocketServer({ server });
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

  const onEvent = (event: RecordingSessionEvent) => {
    if (state.kind === "recording") state = { ...state, lastSeq: event.seq };
    broadcast(event);
  };

  const record = async (
    command: Extract<RecorderCommand, { type: "record" }>
  ) => {
    if (state.kind === "closed")
      throw new Refusal("Open the recorder for a Video first.");
    if (state.kind === "recording") throw new Refusal("Already recording.");
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
    const screens = await listScreens(o.launch);
    const screen = findByName(screens, (s) => s.name, SCREEN_NAME);
    if (!screen) {
      throw new Refusal(
        `No screen named ${SCREEN_NAME}. Found: ${screens.map((s) => s.name).join(", ") || "none"}`
      );
    }
    if (screen.width !== 1920 || screen.height !== 1080) {
      throw new Refusal(
        `The ${SCREEN_NAME} is ${screen.width}x${screen.height}; the recorder records it at 1920x1080.`
      );
    }
    const videoId = state.videoId;
    session = startRecordingSession({
      launch: o.launch,
      now: o.now,
      videoId,
      folder: command.folder,
      silenceLength: command.silenceLength,
      camera,
      mic,
      screenIndex: screen.index,
      emit: onEvent,
      onEnded: () => {
        session = undefined;
        setState({ kind: "open", videoId });
      },
    });
    fs.appendFileSync(
      indexFile,
      `${JSON.stringify({ recordingSessionId: session.id, eventLog: session.eventLog })}\n`
    );
    setState({
      kind: "recording",
      videoId,
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
    for (const line of fs.readFileSync(eventLog, "utf8").split("\n")) {
      if (!line) continue;
      const event = JSON.parse(line) as RecordingSessionEvent;
      lastSeq = Math.max(lastSeq, event.seq);
      if (event.seq > afterSeq) send(ws, event);
    }
    send(ws, { type: "replay-done", recordingSessionId, lastSeq });
  };

  const handle = async (ws: WebSocket, command: RecorderCommand) => {
    if (command.type === "replay") {
      return replay(ws, command.recordingSessionId, command.afterSeq);
    }
    if (!ffmpeg.ok) throw new Refusal(ffmpeg.message);
    switch (command.type) {
      case "open":
        if (state.kind === "recording") {
          throw new Refusal(
            "Stop recording before opening the recorder for another Video."
          );
        }
        return setState({ kind: "open", videoId: command.videoId });
      case "record":
        return record(command);
      case "stop":
        if (!session) throw new Refusal("Not recording.");
        return session.stop();
      case "close":
        if (state.kind === "recording")
          throw new Refusal("Stop recording before closing the recorder.");
        return setState({ kind: "closed" });
    }
  };

  let recovered: string[] = [];
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
    void recovering.then(() =>
      send(ws, { type: "hello", ffmpeg, warnings, state, recovered })
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
      for (const ws of wss.clients) ws.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
};
