import { FileSystem } from "@effect/platform";
import { Data, Effect } from "effect";
import { desc, eq } from "drizzle-orm";
import path from "node:path";
import { audioCalibrations } from "@/db/schema";
import {
  UNCALIBRATED_SILENCE_THRESHOLD,
  type SilenceThreshold,
} from "@/silence-detection-constants";
import {
  deriveThreshold,
  judgeCalibration,
  MEASUREMENT_WINDOWS,
  SCRIPT_SCHEDULE,
  SCRIPT_VERSION,
} from "@/audio-calibration-constants";
import type {
  BrowserTracePoint,
  SavedAudioCalibration,
} from "@/features/audio-calibration/calibration-wire";
import type { CalibrationMeasured } from "@/services/recorder-client/calibration-commands";
import { assertUnderEffect } from "@/services/assert-under";
import { dbCall } from "@/services/clip-service-handler.helpers";
import {
  DrizzleService,
  type Database,
} from "@/services/drizzle-service.server";

/** Beside a calibration's mic file: the browser's level trace and the prompt schedule. */
export const BROWSER_TRACE_FILE = "browser-trace.json";

/** The recorder service measured a run other than the one the page followed. */
export class CalibrationRunMismatchError extends Data.TaggedError(
  "CalibrationRunMismatchError"
)<{ readonly message: string }> {}

/**
 * Stores an Audio Calibration from its run's measurement, passed or failed:
 * judges the speech loudness against the band, derives the threshold, writes
 * the browser's trace beside the mic file (with the schedule its prompts
 * followed, in the same seconds), and saves the row.
 */
export const recordAudioCalibration = Effect.fn("recordAudioCalibration")(
  function* (
    db: Database,
    o: {
      calibrationId: string;
      measured: CalibrationMeasured;
      /** The folder (WSL path) the run's own folder was made in. */
      recordingsFolder: string;
      browserInputLabel: string | null;
      browserTrace: BrowserTracePoint[] | null;
    }
  ) {
    const { measured } = o;
    if (measured.calibrationId !== o.calibrationId)
      return yield* new CalibrationRunMismatchError({
        message: `The recorder service measured run ${measured.calibrationId}, not ${o.calibrationId}.`,
      });
    const judgement = judgeCalibration(measured);
    const thresholdDb = deriveThreshold(measured.speechLufs);
    // The mic file's folder comes from the recorder service: it must be in
    // the recordings folder the run was started in.
    const browserTracePath = yield* assertUnderEffect(
      o.recordingsFolder,
      path.join(path.dirname(measured.micFile), BROWSER_TRACE_FILE)
    );
    const fs = yield* FileSystem.FileSystem;
    yield* fs.writeFileString(
      browserTracePath,
      JSON.stringify({
        scriptVersion: SCRIPT_VERSION,
        schedule: SCRIPT_SCHEDULE,
        measurementWindows: MEASUREMENT_WINDOWS,
        browserInputLabel: o.browserInputLabel,
        trace: o.browserTrace,
      })
    );
    const [row] = yield* dbCall(() =>
      db
        .insert(audioCalibrations)
        .values({
          id: measured.calibrationId,
          outcome: judgement.outcome,
          noiseFloorDb: measured.noiseFloorDb,
          speechLufs: measured.speechLufs,
          thresholdDb,
          recorderMic: measured.mic,
          browserInputLabel: o.browserInputLabel,
          scriptVersion: SCRIPT_VERSION,
          micFilePath: measured.micFile,
          browserTracePath,
        })
        .returning()
    );
    const saved = row!;
    return {
      id: saved.id,
      createdAt: saved.createdAt.toISOString(),
      outcome: saved.outcome,
      judgement,
      noiseFloorDb: saved.noiseFloorDb,
      speechLufs: saved.speechLufs,
      thresholdDb: saved.thresholdDb,
      recorderMic: saved.recorderMic,
      browserInputLabel: saved.browserInputLabel,
    } satisfies SavedAudioCalibration;
  }
);

/**
 * The silence threshold a Recording Session that starts now cuts with: the
 * latest passed Audio Calibration's, or the fixed default while none has
 * passed. Read once, when recording starts; the Recording Session keeps it.
 */
export const currentSilenceThreshold = Effect.fn("currentSilenceThreshold")(
  function* (db: Database) {
    const latest = yield* dbCall(() =>
      db.query.audioCalibrations.findFirst({
        where: eq(audioCalibrations.outcome, "passed"),
        orderBy: desc(audioCalibrations.createdAt),
        columns: { id: true, thresholdDb: true },
      })
    );
    return latest
      ? ({
          thresholdDb: latest.thresholdDb,
          audioCalibrationId: latest.id,
        } satisfies SilenceThreshold)
      : UNCALIBRATED_SILENCE_THRESHOLD;
  }
);

/** `currentSilenceThreshold` on the app's database. */
export const silenceThresholdNow = Effect.gen(function* () {
  return yield* currentSilenceThreshold(yield* DrizzleService);
});
