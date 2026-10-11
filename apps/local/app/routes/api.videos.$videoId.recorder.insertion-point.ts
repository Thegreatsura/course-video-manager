import { Effect, Schema } from "effect";
import { InsertionPointSchema } from "@/services/clip-service.schemas";
import { recorderClient } from "@/services/recorder-client/live.server";
import { makeAction } from "@/services/route-action.server";

const schema = Schema.Struct({ insertionPoint: InsertionPointSchema });

/** The editor moved its insertion point: the recorder's next Clip goes there. */
export const action = makeAction({
  input: "json",
  effect: ({ params, payload }) =>
    Effect.gen(function* () {
      const { insertionPoint } = yield* Schema.decodeUnknown(schema)(payload);
      recorderClient().setInsertionPoint(params.videoId!, insertionPoint);
      return { ok: true };
    }),
});
