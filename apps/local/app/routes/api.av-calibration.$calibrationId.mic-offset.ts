import { Effect, Schema } from "effect";
import { saveMicOffset } from "@/services/av-calibration.server";
import { DrizzleService } from "@/services/drizzle-service.server";
import { recorderClient } from "@/services/recorder-client/live.server";
import { makeAction } from "@/services/route-action.server";

const saveSchema = Schema.Struct({ micOffsetMs: Schema.Number });

/**
 * The clap step's Save (#2137): stores the Mic Offset Matt lined up on the
 * latest AV Calibration, which passes it and unblocks recording. Answers
 * the stored calibration (`SavedAVCalibration`).
 */
export const action = makeAction({
  input: "json",
  errors: { NotLatestCalibrationError: 409, LoudnessCheckFailedError: 409 },
  effect: ({ payload, params }) =>
    Effect.gen(function* () {
      const { micOffsetMs } = yield* Schema.decodeUnknown(saveSchema)(payload);
      const saved = yield* saveMicOffset(yield* DrizzleService, {
        calibrationId: params.calibrationId!,
        micOffsetMs,
      });
      // A Stream Deck Record from now on goes by the new calibration.
      recorderClient().calibrationChanged();
      return saved;
    }),
});
