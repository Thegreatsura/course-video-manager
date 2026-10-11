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
 * The same port serves the MJPEG previews over HTTP, straight to the
 * browser: `GET /preview/camera` and `GET /preview/screen`
 * (`multipart/x-mixed-replace`, so an `<img>` shows them), and the camera's
 * still for the thumbnail camera: `GET /still` (`STILL_PATH`).
 *
 * Scenes arrive in later slices as more members of these unions.
 */

/** The WebSocket and the MJPEG previews' HTTP port. */
export const RECORDER_SERVICE_PORT = 5177;

export const PREVIEW_FEEDS = ["camera", "screen"] as const;
export type PreviewFeed = (typeof PREVIEW_FEEDS)[number];

/** The path the service serves a preview feed on. */
export const previewPath = (feed: PreviewFeed) => `/preview/${feed}`;

/**
 * Where the service serves the camera's still: the latest 1280x720 JPEG of
 * the Cam Link, while the recorder is open and not recording (the thumbnail
 * camera, which used the OBS Virtual Camera). Otherwise it answers with an
 * error status and one of the messages below as plain text.
 */
export const STILL_PATH = "/still";

export const STILL_RECORDER_CLOSED =
  "The recorder is not open: it opens while the editor or the thumbnail camera is open on a New recorder Video.";
export const STILL_WHILE_RECORDING =
  "The recorder is recording: stop it to take a still.";
export const STILL_NO_PICTURE =
  "The camera has no picture yet: wait for it to go live.";

/**
 * The Cam Link while the recorder is open and not recording. It opens with
 * the recorder, and is live once its first real frame arrives; it is tried
 * up to three times before the service asks for a replug.
 */
export type CameraStatus =
  | { kind: "opening"; attempt: number }
  | { kind: "live" }
  /** Three tries brought no frames: "unplug and replug it", then Retry. */
  | { kind: "not-starting"; message: string }
  /** Another program (OBS) holds it. The service never closes OBS itself. */
  | { kind: "busy"; message: string };

export type RecorderCommand =
  /**
   * Open the recorder for a Video: opens the camera and the previews. Open
   * already, for any Video, it keeps the camera and only changes the Video.
   */
  | { type: "open"; videoId: string }
  /** Try the camera again after `not-starting` or `busy`. */
  | { type: "retry-camera" }
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

/**
 * Frames lost in a Recording Session, per picture file: the frames each
 * process's ffmpeg counted as duplicated or dropped in its `-progress`, plus,
 * for the camera, the frames DirectShow dropped from a full real-time buffer.
 */
export type FramesLost = { camera: number; screen: number };

/**
 * What a file needed after a crash: `readable` as it was, `remuxed` to give
 * it a duration (the raw file is kept as `<name>.raw.mkv`), `missing`, or
 * `failed` (left as it was).
 */
export type FileRepair = "readable" | "remuxed" | "missing" | "failed";

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
  /**
   * The camera process quit on its own, or the Cam Link stopped sending
   * frames: the Recording Session stops (`recording-stopped` follows, reason
   * `camera-lost`), keeping its files.
   */
  | { type: "camera-lost"; fileTime: number; errors: string[] }
  | {
      type: "recording-stopped";
      /**
       * `ffmpeg-exited`: the screen process quit on its own and the camera's
       * was stopped. `camera-lost`: see `camera-lost`.
       */
      reason: "requested" | "ffmpeg-exited" | "camera-lost";
      fileTime: number;
      files: RecordingSessionFiles;
      exitCodes: { screen: number | null; camera: number | null };
      framesLost: FramesLost;
      /** The last error lines of a process that quit on its own. */
      errors: string[];
    }
  /**
   * Found at start-up with no stop in its log: the recorder service died
   * while it recorded. Logged then, after a `speech-ended` at the end of the
   * repaired mic file for a take still going at the crash.
   */
  | {
      type: "recording-crashed";
      files: RecordingSessionFiles;
      repairs: Record<keyof RecordingSessionFiles, FileRepair>;
    }
>;

export type RecorderState =
  | { kind: "closed" }
  | { kind: "open"; videoId: string; camera: CameraStatus }
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
      /**
       * Recording Sessions this run of the service found cut off and logged
       * `recording-crashed` for. A client replays each to catch up.
       */
      recovered: string[];
    }
  | { type: "state"; state: RecorderState }
  | { type: "refused"; command: RecorderCommand["type"]; message: string }
  | { type: "replay-done"; recordingSessionId: string; lastSeq: number };

export type RecorderMessage = RecordingSessionEvent | RecorderStatusMessage;
