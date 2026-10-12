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
  /** The mic's loudness now, in LUFS: momentary (400 ms) and short-term (3 s). */
  | { type: "meter-reading"; momentaryLufs: number; shortTermLufs: number }
  /** The meter is not running, and why: refused, quit, or no recorder service. */
  | { type: "meter-failed"; message: string };

export const LEVEL_METER_MESSAGE_TYPES = [
  "meter-started",
  "meter-reading",
  "meter-failed",
] as const satisfies readonly LevelMeterMessage["type"][];
