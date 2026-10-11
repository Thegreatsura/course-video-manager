import { Data, Effect } from "effect";
import { WebSocket } from "ws";
import {
  previewPath,
  type RecorderCommand,
  type RecorderMessage,
  type RecorderState,
} from "recorder-service/protocol";
import type { NewRecorderMessage } from "@/features/video-editor/new-recorder-wire";
import type { InsertionPoint } from "@/services/clip-service";
import type { SilenceLength } from "@/silence-detection-constants";
import type { IngestResult } from "./ingest.server";
import { createRecorderEventSequencer, type SequencedEvent } from "./sequencer";

/**
 * THE RECORDER CLIENT: the app server's one WebSocket to the recorder service
 * (ADR 0034). It sends Record and Stop for the editor, saves what the
 * recorder's events mean (`ingest.server.ts`) one at a time and in order,
 * and passes what was saved on to the editors open on that Video.
 *
 * It keeps, per Video, where the next Clip goes: the editor's insertion point
 * as sent with Record (and whenever it moves), then after each Clip placed.
 *
 * An editor listening is what keeps the recorder open: the first editor on a
 * New recorder Video opens the recorder for it (which opens the Cam Link and
 * the previews), and once the last editor has gone, for longer than a page
 * reload takes, the recorder closes and lets the camera go. Several Videos
 * listening: the one most recently opened has it. A recording is never
 * closed this way; it closes once stopped, if nobody listens by then.
 */

export class RecorderUnavailableError extends Error {}
export class RecorderRefusedError extends Error {}

/** Record or Stop was refused, or the recorder service did not answer. */
export class RecorderCommandError extends Data.TaggedError(
  "RecorderCommandError"
)<{ readonly message: string; readonly cause: unknown }> {}

/** A recorder client call, as an Effect a route can run. */
export const recorderCommand = (run: () => Promise<void>) =>
  Effect.tryPromise({
    try: run,
    catch: (cause) =>
      new RecorderCommandError({
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  });

export type RecorderClientOptions = {
  url: string;
  /** Saves one event; the client runs one at a time. */
  ingest: (
    event: SequencedEvent,
    insertionPointFor: (videoId: string) => InsertionPoint | undefined
  ) => Promise<IngestResult>;
  /**
   * The Recording Sessions the database still has as recording. Each is
   * replayed whenever the recorder service greets the client, so a stop or a
   * crash it missed (the app server was down) is caught up on.
   */
  unfinishedRecordingSessions: () => Promise<string[]>;
  /** How long to wait before reconnecting to a recorder service that went away. */
  reconnectMs: number;
  /** How long a command may take to be carried out. */
  commandTimeoutMs: number;
  /** How long the recorder stays open after its last editor goes (a reload). */
  closeGraceMs: number;
};

/** The camera, as an editor on `videoId` hears it, from the recorder's state. */
const cameraMessage = (
  state: RecorderState,
  videoId: string
): NewRecorderMessage | undefined => {
  if (state.kind === "recording" && state.videoId === videoId) return undefined;
  if (state.kind !== "open" || state.videoId !== videoId)
    return { type: "camera-closed" };
  const camera = state.camera;
  switch (camera.kind) {
    case "opening":
      return { type: "camera-opening", attempt: camera.attempt };
    case "live":
      return { type: "camera-went-live" };
    case "not-starting":
      return { type: "cam-link-not-starting", message: camera.message };
    case "busy":
      return { type: "cam-link-busy", message: camera.message };
  }
};

type Listener = (message: NewRecorderMessage) => void;

type Waiter = {
  command: RecorderCommand["type"];
  done: (message: RecorderMessage) => boolean;
  resolve: () => void;
  reject: (error: Error) => void;
};

export const createRecorderClient = (o: RecorderClientOptions) => {
  const listeners = new Map<string, Set<Listener>>();
  const insertionPoints = new Map<string, InsertionPoint>();
  const sequencer = createRecorderEventSequencer();
  let waiters: Waiter[] = [];
  let socket: WebSocket | undefined;
  let reachable = false;
  let problem: string | null = null;
  let state: RecorderState = { kind: "closed" };
  let closed = false;
  let ingesting: Promise<void> = Promise.resolve();
  /** Videos with editors listening, the most recently opened last. */
  let wanted: string[] = [];
  /** The Video last asked to be open (null: asked to close), until it is. */
  let asked: string | null | undefined;
  const lastCamera = new Map<string, string>();
  const previews = (() => {
    const http = o.url.replace(/^ws/, "http");
    return {
      camera: `${http}${previewPath("camera")}`,
      screen: `${http}${previewPath("screen")}`,
    };
  })();

  const publish = (videoId: string, message: NewRecorderMessage) => {
    for (const listener of listeners.get(videoId) ?? []) listener(message);
  };
  const statusFor = (videoId: string): NewRecorderMessage => ({
    type: "recorder-status",
    reachable,
    problem,
    recordingSessionId:
      state.kind === "recording" && state.videoId === videoId
        ? state.recordingSessionId
        : null,
    previews,
  });
  /** The camera's state, to an editor, only when it changed. */
  const publishCamera = (videoId: string) => {
    const message = reachable
      ? cameraMessage(state, videoId)
      : ({ type: "camera-closed" } as const);
    if (!message) return;
    const key = JSON.stringify(message);
    if (lastCamera.get(videoId) === key) return;
    lastCamera.set(videoId, key);
    publish(videoId, message);
  };
  const publishStatus = () => {
    for (const videoId of listeners.keys()) {
      publish(videoId, statusFor(videoId));
      publishCamera(videoId);
    }
  };

  const send = (command: RecorderCommand) => {
    if (socket?.readyState === WebSocket.OPEN)
      socket.send(JSON.stringify(command));
  };

  /** Opens the recorder for the Video an editor wants, or closes it for none. */
  const reconcile = () => {
    if (!reachable || problem || state.kind === "recording") return;
    const want = wanted.at(-1) ?? null;
    const has = state.kind === "open" ? state.videoId : null;
    if (want === has) {
      asked = undefined;
      return;
    }
    if (asked === want) return;
    asked = want;
    send(want ? { type: "open", videoId: want } : { type: "close" });
  };

  const ingest = (event: SequencedEvent) => {
    ingesting = ingesting.then(async () => {
      try {
        const result = await o.ingest(event, (videoId) =>
          insertionPoints.get(videoId)
        );
        if (!result.videoId) return;
        if (result.insertionPoint)
          insertionPoints.set(result.videoId, result.insertionPoint);
        for (const message of result.messages) publish(result.videoId, message);
      } catch (error) {
        console.error(`recorder client: could not save ${event.type}`, error);
        const message = `Could not save the recorder's ${event.type}: ${error instanceof Error ? error.message : String(error)}`;
        for (const videoId of listeners.keys())
          publish(videoId, { type: "recorder-failed", message });
      }
    });
  };

  /**
   * Replays, from the start, every Recording Session that may have events
   * this client never saved: the one recording now, the ones the service
   * found crashed, and the ones the database still has as recording. What
   * was saved already is skipped (ingest is idempotent).
   */
  const catchUp = (recovered: string[]) => {
    const ids = new Set(recovered);
    if (state.kind === "recording") ids.add(state.recordingSessionId);
    void o
      .unfinishedRecordingSessions()
      .catch((error: unknown) => {
        console.error(
          "recorder client: could not read unfinished Recording Sessions",
          error
        );
        return [];
      })
      .then((unfinished) => {
        for (const id of unfinished) ids.add(id);
        for (const recordingSessionId of ids)
          send({ type: "replay", recordingSessionId, afterSeq: 0 });
      });
  };

  const onMessage = (message: RecorderMessage) => {
    for (const waiter of waiters.slice()) {
      if (message.type === "refused" && message.command === waiter.command) {
        waiters = waiters.filter((w) => w !== waiter);
        waiter.reject(new RecorderRefusedError(message.message));
      } else if (waiter.done(message)) {
        waiters = waiters.filter((w) => w !== waiter);
        waiter.resolve();
      }
    }
    switch (message.type) {
      case "hello":
        reachable = true;
        problem = message.ffmpeg.ok ? null : message.ffmpeg.message;
        state = message.state;
        asked = undefined;
        reconcile();
        catchUp(message.recovered);
        return publishStatus();
      case "state":
        state = message.state;
        reconcile();
        return publishStatus();
      case "refused":
        // An open or close of our own was refused: ask again on the next state.
        if (message.command === "open" || message.command === "close") {
          asked = undefined;
          const videoId = wanted.at(-1);
          if (message.command === "open" && videoId)
            publish(videoId, {
              type: "recorder-failed",
              message: message.message,
            });
        }
        return;
      case "replay-done":
        return;
      case "recording-started":
      case "screen-recorder-tuned":
      case "speech-started":
      case "speech-ended":
      case "camera-lost":
      case "recording-stopped":
      case "recording-crashed": {
        const { ready, replay } = sequencer.accept(message);
        if (replay) send({ type: "replay", ...replay });
        for (const event of ready) ingest(event);
        return;
      }
    }
  };

  const connect = () => {
    if (closed) return;
    const ws = new WebSocket(o.url);
    socket = ws;
    ws.on("message", (data) => {
      onMessage(JSON.parse(String(data)) as RecorderMessage);
    });
    ws.on("error", () => {
      // `close` follows; nothing answering is the usual case.
    });
    ws.on("close", () => {
      if (socket !== ws) return;
      socket = undefined;
      asked = undefined;
      if (reachable) {
        reachable = false;
        publishStatus();
      }
      for (const waiter of waiters)
        waiter.reject(
          new RecorderUnavailableError("The recorder service went away.")
        );
      waiters = [];
      if (!closed) setTimeout(connect, o.reconnectMs);
    });
  };
  connect();

  /** Sends a command and waits until the recorder has carried it out. */
  const command = (
    sent: RecorderCommand,
    done: (message: RecorderMessage) => boolean
  ) =>
    new Promise<void>((resolve, reject) => {
      if (!reachable || socket?.readyState !== WebSocket.OPEN) {
        reject(
          new RecorderUnavailableError(
            "The recorder service is not running. `pnpm dev` starts it from the main checkout."
          )
        );
        return;
      }
      const timer = setTimeout(() => {
        waiters = waiters.filter((w) => w !== waiter);
        reject(
          new RecorderUnavailableError(
            `The recorder service did not answer ${sent.type}.`
          )
        );
      }, o.commandTimeoutMs);
      const waiter: Waiter = {
        command: sent.type,
        done,
        resolve: () => {
          clearTimeout(timer);
          resolve();
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      };
      waiters.push(waiter);
      send(sent);
    });

  const isState = (
    message: RecorderMessage,
    kind: RecorderState["kind"],
    videoId: string
  ) =>
    message.type === "state" &&
    message.state.kind === kind &&
    message.state.kind !== "closed" &&
    message.state.videoId === videoId;

  return {
    /** Hear what happens to a Video's Recording Sessions; starts with the status. */
    subscribe(videoId: string, listener: Listener) {
      let set = listeners.get(videoId);
      if (!set) listeners.set(videoId, (set = new Set()));
      set.add(listener);
      listener(statusFor(videoId));
      const camera = reachable ? cameraMessage(state, videoId) : undefined;
      if (camera) {
        lastCamera.set(videoId, JSON.stringify(camera));
        listener(camera);
      }
      wanted = [...wanted.filter((v) => v !== videoId), videoId];
      reconcile();
      return () => {
        set.delete(listener);
        if (set.size > 0) return;
        listeners.delete(videoId);
        lastCamera.delete(videoId);
        setTimeout(() => {
          if (listeners.has(videoId)) return;
          wanted = wanted.filter((v) => v !== videoId);
          reconcile();
        }, o.closeGraceMs);
      };
    },

    async startRecording(
      videoId: string,
      request: {
        silenceLength: SilenceLength;
        insertionPoint: InsertionPoint;
        /** The folder (WSL path) each Recording Session's folder goes in. */
        folder: string;
      }
    ) {
      if (problem) throw new RecorderRefusedError(problem);
      insertionPoints.set(videoId, request.insertionPoint);
      await command({ type: "open", videoId }, (m) =>
        isState(m, "open", videoId)
      );
      await command(
        {
          type: "record",
          silenceLength: request.silenceLength,
          folder: request.folder,
        },
        (m) => isState(m, "recording", videoId)
      );
    },

    /** Tries the Cam Link again, after it did not start or was busy. */
    async retryCamera(videoId: string) {
      if (state.kind !== "open" || state.videoId !== videoId)
        throw new RecorderRefusedError(
          "The recorder is not open for this Video."
        );
      await command(
        { type: "retry-camera" },
        (m) =>
          m.type === "state" &&
          m.state.kind === "open" &&
          m.state.camera.kind === "opening"
      );
    },

    async stopRecording(videoId: string) {
      if (state.kind !== "recording" || state.videoId !== videoId)
        throw new RecorderRefusedError("This Video is not recording.");
      await command({ type: "stop" }, (m) => isState(m, "open", videoId));
    },

    /** The editor moved its insertion point: the next Clip goes there. */
    setInsertionPoint(videoId: string, insertionPoint: InsertionPoint) {
      insertionPoints.set(videoId, insertionPoint);
    },

    /** Waits for every event heard so far to be saved (tests). */
    settled: () => ingesting,

    close() {
      closed = true;
      socket?.close();
    },
  };
};

export type RecorderClient = ReturnType<typeof createRecorderClient>;
