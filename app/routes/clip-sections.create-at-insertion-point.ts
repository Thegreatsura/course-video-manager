import { withDatabaseDump } from "@/services/dump-service";
import { Console, Effect, Schema } from "effect";
import { DBService } from "@/services/db-service";
import { layerLive } from "@/services/layer";
import type { Route } from "./+types/clip-sections.create-at-insertion-point";
import { data } from "react-router";

const insertionPointSchema = Schema.Union(
  Schema.Struct({ type: Schema.Literal("start") }),
  Schema.Struct({
    type: Schema.Literal("after-clip"),
    databaseClipId: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("after-clip-section"),
    clipSectionId: Schema.String,
  })
);

const createClipSectionAtInsertionPointSchema = Schema.Struct({
  videoId: Schema.String,
  name: Schema.String,
  insertionPoint: insertionPointSchema,
});

export const action = async (args: Route.ActionArgs) => {
  const json = await args.request.json();

  return Effect.gen(function* () {
    const db = yield* DBService;
    const { videoId, name, insertionPoint } = yield* Schema.decodeUnknown(
      createClipSectionAtInsertionPointSchema
    )(json);

    const clipSection = yield* db.createClipSectionAtInsertionPoint(
      videoId,
      name,
      insertionPoint
    );

    return { success: true, clipSection };
  }).pipe(
    withDatabaseDump,
    Effect.tapErrorCause((e) => Console.dir(e, { depth: null })),
    Effect.catchTag("ParseError", () => {
      return Effect.die(data("Invalid request", { status: 400 }));
    }),
    Effect.catchTag("NotFoundError", () => {
      return Effect.die(
        data("Clip not found for insertion point", { status: 404 })
      );
    }),
    Effect.catchAll(() => {
      return Effect.die(data("Internal server error", { status: 500 }));
    }),
    Effect.provide(layerLive),
    Effect.runPromise
  );
};
