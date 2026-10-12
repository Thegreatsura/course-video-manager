/**
 * What the app server tells the Audio Calibration page of the level meter,
 * over `GET /api/audio-calibration/meter` (one SSE event per message, its
 * `type` as the event name). Listening is what runs the meter: the recorder
 * service's mic-only ffmpeg.exe starts with the first listener and stops
 * when the last one goes.
 */
export type LevelMeterMessage =
  /** The meter is listening to this mic (its DirectShow name). */
  | { type: "meter-started"; mic: string }
  /**
   * The mic's loudness now, in LUFS: momentary (400 ms) and short-term (3 s).
   * `seconds`: since the meter's process started; during an Audio
   * Calibration's run, seconds of its mic file (the recorder service's clock).
   */
  | {
      type: "meter-reading";
      seconds: number;
      momentaryLufs: number;
      shortTermLufs: number;
    }
  /** The meter is not running, and why: refused, quit, or no recorder service. */
  | { type: "meter-failed"; message: string }
  /** An Audio Calibration's run started: readings from here on are its file's. */
  | { type: "calibration-started"; calibrationId: string; mic: string }
  /** The run ended without being measured, and why (its ffmpeg quit, say). */
  | { type: "calibration-failed"; calibrationId: string; message: string };

export const LEVEL_METER_MESSAGE_TYPES = [
  "meter-started",
  "meter-reading",
  "meter-failed",
  "calibration-started",
  "calibration-failed",
] as const satisfies readonly LevelMeterMessage["type"][];
