import { Effect, Schema } from "effect";
import { recordAVCalibration } from "@/services/av-calibration.server";
import { DrizzleService } from "@/services/drizzle-service.server";
import { recorderCommand } from "@/services/recorder-client/recorder-command";
import {
  recorderClient,
  recordingFolder,
} from "@/services/recorder-client/live.server";
import { makeAction } from "@/services/route-action.server";

const WindowSchema = Schema.Struct({
  startSeconds: Schema.Number,
  endSeconds: Schema.Number,
});

const finishSchema = Schema.Struct({
  calibrationId: Schema.String,
  scriptStartSeconds: Schema.Number,
  windows: Schema.Struct({
    silence: WindowSchema,
    speech: Schema.Array(WindowSchema),
    claps: WindowSchema,
  }),
});

/**
 * The script is done: the recorder service ends the run and measures its mic
 * file over the windows the page sends (the clap window cut out of the true
 * peak), the claps are found in its mic and camera files for the Mic Offset,
 * and the AV Calibration is stored, passed or failed, with the run's script
 * file beside its files. Answers the stored calibration
 * (`SavedAVCalibration`).
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
      const windows = {
        silence: request.windows.silence,
        speech: [...request.windows.speech],
        claps: request.windows.claps,
      };
      const measured = yield* recorderCommand(() =>
        recorderClient().finishCalibration(windows)
      );
      const saved = yield* recordAVCalibration(yield* DrizzleService, {
        calibrationId: request.calibrationId,
        measured,
        windows,
        scriptStartSeconds: request.scriptStartSeconds,
        recordingsFolder: recordingFolder(),
      });
      // A Stream Deck Record from now on cuts with the new threshold.
      recorderClient().calibrationChanged();
      return saved;
    }),
});
