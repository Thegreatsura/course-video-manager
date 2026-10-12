import { Effect } from "effect";
import { loadCalibrationTimeline } from "@/services/av-calibration.server";
import { DrizzleService } from "@/services/drizzle-service.server";
import { makeLoader } from "@/services/route-action.server";

/**
 * A stored AV Calibration's review timeline (`CalibrationTimeline`): the
 * prompts, the browser detector and the FFmpeg detector on one time axis,
 * redrawn from its kept mic file and browser trace.
 */
export const loader = makeLoader({
  effect: ({ params }) =>
    Effect.gen(function* () {
      return yield* loadCalibrationTimeline(
        yield* DrizzleService,
        params.calibrationId!
      );
    }),
});
