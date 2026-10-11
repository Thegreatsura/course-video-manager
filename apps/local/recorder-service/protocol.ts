import type { SilenceLength } from "../app/silence-detection-constants";

/**
 * THE RECORDER SERVICE'S WIRE: what a client (the app server's recorder
 * client, later the Stream Deck) sends over the one WebSocket, and what the
 * service sends back. Why the service exists at all is ADR 0034.
 *
 * Two kinds of message come back:
 *
 * - **Recording Session events** carry a `seq`, counted from 1 per Recording
 *   Session, and are the same objects the service appends to that Recording
 *   Session's `events.jsonl`. A client that missed some (it restarted, its
 *   socket dropped) asks for `replay` after the last `seq` it saw and gets
 *   them again, read back from the log, so ingest can be idempotent per
 *   (Recording Session, seq).
 * - **Status messages** have no `seq` and are not logged: the greeting, the
 *   recorder's state, a refused command and the end of a replay.
 *
 * Scenes, stills, camera state and previews arrive in later slices as more
 * members of these unions.
 */

/** The WebSocket (and, later, the MJPEG previews' HTTP) port. */
export const RECORDER_SERVICE_PORT = 5177;

export type RecorderCommand =
  /** Open the recorder for a Video. Later slices open the camera here. */
  | { type: "open"; videoId: string }
  /** Start a Recording Session in a new folder under `folder` (a WSL path). */
  | { type: "record"; silenceLength: SilenceLength; folder: string }
  | { type: "stop" }
  | { type: "close" }
  /** Send this Recording Session's logged events with `seq > afterSeq`. */
  | { type: "replay"; recordingSessionId: string; afterSeq: number };

export type RecordingSessionFiles = {
  camera: string;
  screen: string;
  mic: string;
};

type Logged<T> = T & { seq: number; recordingSessionId: string };

export type RecordingSessionEvent = Logged<
  | {
      type: "recording-started";
      videoId: string;
      /** Windows wall-clock ms that is file time 0 in all three files. */
      t0Ms: number;
      silenceLength: SilenceLength;
      files: RecordingSessionFiles;
    }
  /** The screen recorder's 1 ms timer, no-throttling and High priority. */
  | { type: "screen-recorder-tuned"; ok: boolean; detail: string }
  /** Speech in the mic file, in seconds of file time. */
  | { type: "speech-started"; fileTime: number }
  | { type: "speech-ended"; fileTime: number }
  | {
      type: "recording-stopped";
      /**
       * `ffmpeg-exited`: a process quit on its own and the other was stopped.
       * `event-log-failed`: `events.jsonl` could not be written, so both were
       * stopped rather than record what a replay could never send.
       */
      reason: "requested" | "ffmpeg-exited" | "event-log-failed";
      fileTime: number;
      files: RecordingSessionFiles;
      exitCodes: { screen: number | null; camera: number | null };
      /** Why the event log failed, and the last error lines of a process that quit on its own. */
      errors: string[];
    }
>;

export type RecorderState =
  | { kind: "closed" }
  | { kind: "open"; videoId: string }
  | {
      kind: "recording";
      videoId: string;
      recordingSessionId: string;
      lastSeq: number;
    };

export type FfmpegCheck =
  { ok: true; version: string } | { ok: false; message: string };

export type RecorderStatusMessage =
  | {
      type: "hello";
      ffmpeg: FfmpegCheck;
      /** Start-up warnings that do not stop recording (an NVIDIA driver change). */
      warnings: string[];
      state: RecorderState;
    }
  | { type: "state"; state: RecorderState }
  | { type: "refused"; command: RecorderCommand["type"]; message: string }
  | { type: "replay-done"; recordingSessionId: string; lastSeq: number };

export type RecorderMessage = RecordingSessionEvent | RecorderStatusMessage;
