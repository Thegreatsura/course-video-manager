import { Effect } from "effect";
import { loadClapStep } from "@/services/av-calibration.server";
import { DrizzleService } from "@/services/drizzle-service.server";
import { makeLoader } from "@/services/route-action.server";

/**
 * The latest AV Calibration's clap step (#2137, `ClapStepData`): where the
 * loudest point is, the waveform around it, and the Mic Offset to start from.
 */
export const loader = makeLoader({
  errors: {
    NotLatestCalibrationError: 409,
    LoudnessCheckFailedError: 409,
    StorageFileNotFoundError: 404,
    ClapStepFfmpegError: 500,
  },
  effect: ({ params }) =>
    Effect.gen(function* () {
      return yield* loadClapStep(yield* DrizzleService, params.calibrationId!);
    }),
});
