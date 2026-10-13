import { Effect, Schema } from "effect";
import { clapPreviewMp4, frameMs } from "@/packages/clap-step/server";
import { clapStepFiles } from "@/services/av-calibration.server";
import { DrizzleService } from "@/services/drizzle-service.server";
import { makeLoader } from "@/services/route-action.server";

const query = Schema.Struct({
  frame: Schema.NumberFromString,
  micOffsetMs: Schema.NumberFromString,
});

/**
 * Play, in the clap step: about 2 s of the latest AV Calibration's camera
 * centred on the video slider's frame, the mic played the Mic Offset later.
 */
export const loader = makeLoader({
  errors: {
    NotLatestCalibrationError: 409,
    LoudnessCheckFailedError: 409,
    StorageFileNotFoundError: 404,
    ClapStepFfmpegError: 500,
  },
  effect: ({ params, request }) =>
    Effect.gen(function* () {
      const { frame, micOffsetMs } = yield* Schema.decodeUnknown(query)(
        Object.fromEntries(new URL(request.url).searchParams)
      );
      const { cameraFile, micFile } = yield* clapStepFiles(
        yield* DrizzleService,
        params.calibrationId!
      );
      const mp4 = yield* clapPreviewMp4({
        cameraFile,
        micFile,
        videoMs: frameMs(frame),
        micOffsetMs,
      });
      return new Response(mp4, {
        headers: {
          "Content-Type": "video/mp4",
          "Cache-Control": "private, max-age=3600",
        },
      });
    }),
});
