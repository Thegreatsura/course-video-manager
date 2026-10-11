import { Effect, Schema } from "effect";
import { PitchOperationsService } from "@/services/db-pitch-operations.server";
import { makeAction } from "@/services/route-action.server";
import { data } from "react-router";
import { VIDEO_RECORDERS } from "@cvm/core/features/videos/recorder";

const createVideoSchema = Schema.Struct({
  recorder: Schema.optional(
    Schema.Union(Schema.Literal(...VIDEO_RECORDERS), Schema.Literal(""))
  ),
});

export const action = makeAction({
  input: "formData",
  errors: { NotFoundError: 404 },
  effect: ({ params, payload }) =>
    Effect.gen(function* () {
      const { recorder } =
        yield* Schema.decodeUnknown(createVideoSchema)(payload);
      const pitchOps = yield* PitchOperationsService;
      const video = yield* pitchOps.createVideoFromPitch(params.pitchId!, {
        recorder: recorder || null,
      });
      return data({ id: video.id });
    }),
});
