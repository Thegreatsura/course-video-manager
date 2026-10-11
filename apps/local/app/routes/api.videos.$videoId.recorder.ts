import { Effect, Schema } from "effect";
import { VIDEO_RECORDERS } from "@cvm/core/features/videos/recorder";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { makeAction } from "@/services/route-action.server";

const chooseRecorderSchema = Schema.Struct({
  recorder: Schema.Literal(...VIDEO_RECORDERS),
});

/** Choose the Recorder a Video records with (the editor's Recorder picker). */
export const action = makeAction({
  input: "json",
  errors: { VideoRecorderLockedError: 409 },
  effect: ({ params, payload }) =>
    Effect.gen(function* () {
      const { recorder } =
        yield* Schema.decodeUnknown(chooseRecorderSchema)(payload);
      const videoOps = yield* VideoOperationsService;
      yield* videoOps.updateVideoRecorder({
        videoId: params.videoId!,
        recorder,
      });
      return { recorder };
    }),
});
