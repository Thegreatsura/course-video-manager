import type { DB } from "@/db/schema";
import type { InsertionPoint } from "@/services/clip-service";
import type { SilenceLength } from "@/silence-detection-constants";

/**
 * What the app server's recorder client tells an editor open on a New
 * recorder Video, over `GET /api/videos/:videoId/recorder/events` (one SSE
 * event per message, its `type` as the event name). Every message is a fact:
 * the recorder service's events about this Video's Recording Sessions, after
 * the app server has saved what they mean, and the recorder's status.
 */
export type NewRecorderMessage =
  | {
      /** Sent first, and whenever the recorder service comes or goes. */
      type: "recorder-status";
      /** False while nothing answers on the recorder service's port. */
      reachable: boolean;
      /** Why the recorder cannot record (a wrong ffmpeg), when it cannot. */
      problem: string | null;
      /** The Recording Session in progress for this Video, if any. */
      recordingSessionId: string | null;
      /** Where the browser watches the raw camera and screen (MJPEG, for an `<img>`). */
      previews: { camera: string; screen: string };
      /** Where the browser fetches the camera's still (a 1280x720 JPEG): the thumbnail camera. */
      still: string;
    }
  /**
   * The Cam Link, while the recorder is open for this Video and not
   * recording. Record waits for `camera-went-live`.
   */
  | { type: "camera-opening"; attempt: number }
  | { type: "camera-went-live" }
  /** Three tries brought no frames: replug, then Retry. */
  | { type: "cam-link-not-starting"; message: string }
  /** Another program (OBS) holds the Cam Link: close it, then Retry. */
  | { type: "cam-link-busy"; message: string }
  /** The recorder is not open for this Video (closed, or open for another). */
  | { type: "camera-closed" }
  | {
      type: "recording-started";
      recordingSessionId: string;
      silenceLength: SilenceLength;
      /** The Recording Session's mic file: each of its Clips' Footage path. */
      micFile: string;
    }
  | { type: "speech-started"; recordingSessionId: string }
  | { type: "speech-ended"; recordingSessionId: string }
  | {
      /** Speech became saved Clips, placed after `placedAt`, in order. */
      type: "clips-saved";
      recordingSessionId: string;
      clips: DB.Clip[];
      placedAt: InsertionPoint;
      /** The `transcribe-clips` Job the app server enqueued for them. */
      transcriptionJobId: string;
    }
  | {
      type: "recording-stopped";
      recordingSessionId: string;
      /** Why the recorder stopped, when it was not asked to. */
      errors: string[];
    }
  | {
      /** The recorder service refused a command, or saving its events failed. */
      type: "recorder-failed";
      message: string;
    };

export const NEW_RECORDER_MESSAGE_TYPES = [
  "recorder-status",
  "camera-opening",
  "camera-went-live",
  "cam-link-not-starting",
  "cam-link-busy",
  "camera-closed",
  "recording-started",
  "speech-started",
  "speech-ended",
  "clips-saved",
  "recording-stopped",
  "recorder-failed",
] as const satisfies readonly NewRecorderMessage["type"][];

/** What the editor sends with Record. */
export type StartRecordingRequest = {
  silenceLength: SilenceLength;
  /** The editor's insertion point, resolved to saved items. */
  insertionPoint: InsertionPoint;
};
