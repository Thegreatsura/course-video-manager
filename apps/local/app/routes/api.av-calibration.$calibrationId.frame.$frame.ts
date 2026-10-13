import { Effect } from "effect";
import { cameraFrameJpeg } from "@/packages/clap-step/server";
import { clapStepFiles } from "@/services/av-calibration.server";
import { DrizzleService } from "@/services/drizzle-service.server";
import { makeLoader } from "@/services/route-action.server";

/** One camera frame of the latest AV Calibration, for the clap step's video slider. */
export const loader = makeLoader({
  errors: {
    NotLatestCalibrationError: 409,
    LoudnessCheckFailedError: 409,
    StorageFileNotFoundError: 404,
    ClapStepFfmpegError: 500,
  },
  effect: ({ params }) =>
    Effect.gen(function* () {
      const frame = Number(params.frame);
      if (!Number.isInteger(frame) || frame < 0)
        return new Response("Not a frame", { status: 400 });
      const { cameraFile } = yield* clapStepFiles(
        yield* DrizzleService,
        params.calibrationId!
      );
      const jpeg = yield* cameraFrameJpeg({ cameraFile, frame });
      return new Response(jpeg, {
        headers: {
          "Content-Type": "image/jpeg",
          // A frame of a file never changes.
          "Cache-Control": "private, max-age=3600",
        },
      });
    }),
});
