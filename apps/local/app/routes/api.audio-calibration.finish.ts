import { Effect, Schema } from "effect";
import { MEASUREMENT_WINDOWS } from "@/audio-calibration-constants";
import { recordAudioCalibration } from "@/services/audio-calibration.server";
import { DrizzleService } from "@/services/drizzle-service.server";
import { recorderCommand } from "@/services/recorder-client/recorder-command";
import {
  recorderClient,
  recordingFolder,
} from "@/services/recorder-client/live.server";
import { makeAction } from "@/services/route-action.server";

const finishSchema = Schema.Struct({
  calibrationId: Schema.String,
  browserInputLabel: Schema.NullOr(Schema.String),
  browserTrace: Schema.NullOr(
    Schema.Array(
      Schema.Struct({ seconds: Schema.Number, peakDb: Schema.Number })
    )
  ),
});

/**
 * The script is done: the recorder service ends the run and measures its mic
 * file over the measurement windows, and the Audio Calibration is stored,
 * passed or failed, with the browser's level trace beside the file. Answers
 * the stored calibration (`SavedAudioCalibration`).
 */
export const action = makeAction({
  input: "json",
  errors: {
    RecorderCommandError: 409,
    CalibrationRunMismatchError: 409,
    PathOutsideBaseDirError: 409,
  },
  effect: ({ payload }) =>
    Effect.gen(function* () {
      const request = yield* Schema.decodeUnknown(finishSchema)(payload);
      const measured = yield* recorderCommand(() =>
        recorderClient().finishCalibration(MEASUREMENT_WINDOWS)
      );
      return yield* recordAudioCalibration(yield* DrizzleService, {
        calibrationId: request.calibrationId,
        measured,
        recordingsFolder: recordingFolder(),
        browserInputLabel: request.browserInputLabel,
        browserTrace: request.browserTrace ? [...request.browserTrace] : null,
      });
    }),
});
