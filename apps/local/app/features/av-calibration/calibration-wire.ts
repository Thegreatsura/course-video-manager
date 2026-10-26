import type {
  CalibrationJudgement,
  CalibrationOutcome,
  MeasurementWindows,
} from "@/av-calibration-constants";

/**
 * What the AV Calibration page and the app server say to each other about
 * a run, over `POST /api/av-calibration/{start,cancel,finish}`. The run's
 * progress itself comes over the level meter's stream (`level-meter-wire.ts`).
 */

/** `POST /api/av-calibration/finish`: the script is done; measure and store it. */
export type FinishCalibrationRequest = {
  /** The run the page followed (`calibration-started`). */
  calibrationId: string;
  /** Where the script started in the run's files (`calibration-started`). */
  scriptStartSeconds: number;
  /**
   * What to measure over, in the run's file seconds: the silence, the
   * speech, and the clap window (the Mic Offset's, cut out of the peak).
   */
  windows: MeasurementWindows;
};

/** A stored AV Calibration, as the page shows it. */
export type SavedAVCalibration = {
  id: string;
  createdAt: string;
  outcome: CalibrationOutcome;
  judgement: CalibrationJudgement;
  noiseFloorDb: number;
  speechLufs: number;
  /** The take's true peak, in dBTP; null when stored before the peak check. */
  truePeakDb: number | null;
  thresholdDb: number;
  recorderMic: string;
  /** The recorder service's camera; null before the clap step. */
  cameraDevice: string | null;
  /** Claps found in both mic and camera; null before the clap step. */
  clapsFound: number | null;
  /** Max - min of the claps' offsets, in ms; null with none found. */
  clapSpreadMs: number | null;
  /** The Mic Offset, in ms; null with no clap found. */
  micOffsetMs: number | null;
};
