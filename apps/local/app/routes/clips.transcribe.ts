import { Effect, Schema } from "effect";
import { makeAction } from "@/services/route-action.server";
import { transcribeAndStoreClips } from "@/services/clip-transcription.server";

const transcribeClipsSchema = Schema.Struct({
  clipIds: Schema.Array(Schema.String),
});

export const action = makeAction({
  input: "json",
  effect: ({ payload: json }) =>
    Effect.gen(function* () {
      const { clipIds } = yield* Schema.decodeUnknown(transcribeClipsSchema)(
        json
      );
      return yield* transcribeAndStoreClips(clipIds);
    }),
});
