import { Console, Effect, Schema } from "effect";
import { runtimeLive } from "@/services/layer.server";
import { withDatabaseDump } from "@/services/dump-service";
import { concatenateVideos } from "@/services/video-concatenation-service";
import type { Route } from "./+types/api.videos.concatenate";
import { data } from "react-router";

const ConcatenateSchema = Schema.Struct({
  name: Schema.String.pipe(Schema.minLength(1)),
  sourceVideoIds: Schema.Array(Schema.String.pipe(Schema.minLength(1))).pipe(
    Schema.minItems(1)
  ),
});

export const action = async (args: Route.ActionArgs) => {
  const body = await args.request.json();

  return Effect.gen(function* () {
    const input = yield* Schema.decodeUnknown(ConcatenateSchema)(body);

    const newVideo = yield* concatenateVideos({
      name: input.name,
      sourceVideoIds: [...input.sourceVideoIds],
    });

    return data({ id: newVideo.id });
  }).pipe(
    withDatabaseDump,
    Effect.tapErrorCause((e) => Console.dir(e, { depth: null })),
    Effect.catchTag("ParseError", () => {
      return Effect.die(data("Invalid request", { status: 400 }));
    }),
    Effect.catchAll(() => {
      return Effect.die(data("Internal server error", { status: 500 }));
    }),
    runtimeLive.runPromise
  );
};
