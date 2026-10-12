import type {
  CalibrationJudgement,
  CalibrationOutcome,
} from "@/audio-calibration-constants";

/**
 * What the Audio Calibration page and the app server say to each other about
 * a run, over `POST /api/audio-calibration/{start,cancel,finish}`. The run's
 * progress itself comes over the level meter's stream (`level-meter-wire.ts`).
 */

/**
 * One block of the browser detector's input (1024 samples, ~21 ms): its peak
 * across every channel, in dBFS, timed in seconds of the run's mic file.
 * Silence is a block whose peak is under the threshold, as `silence-scan.ts`
 * judges each sample.
 */
export type BrowserTracePoint = { seconds: number; peakDb: number };

/** `POST /api/audio-calibration/finish`: the script is done; measure and store it. */
export type FinishCalibrationRequest = {
  /** The run the page followed (`calibration-started`). */
  calibrationId: string;
  /** The label of the browser's audio input; null when it could not be opened. */
  browserInputLabel: string | null;
  /** What the browser detector heard during the run; null with no input. */
  browserTrace: BrowserTracePoint[] | null;
};

/** A stored Audio Calibration, as the page shows it. */
export type SavedAudioCalibration = {
  id: string;
  createdAt: string;
  outcome: CalibrationOutcome;
  judgement: CalibrationJudgement;
  noiseFloorDb: number;
  speechLufs: number;
  thresholdDb: number;
  recorderMic: string;
  browserInputLabel: string | null;
};
