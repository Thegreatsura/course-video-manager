import { Console, Effect } from "effect";
import type { Route } from "./+types/api.thumbnails.$thumbnailId.deselect";
import { DBFunctionsService } from "@/services/db-service";
import { runtimeLive } from "@/services/layer";
import { data } from "react-router";

export const action = async (args: Route.ActionArgs) => {
  const { thumbnailId } = args.params;

  return Effect.gen(function* () {
    const db = yield* DBFunctionsService;
    const thumbnail = yield* db.getThumbnailById(thumbnailId);
    yield* db.deselectAllThumbnails(thumbnail.videoId);
    return { success: true };
  }).pipe(
    Effect.tapErrorCause((e) => Console.dir(e, { depth: null })),
    Effect.catchTag("NotFoundError", () => {
      return Effect.die(data("Thumbnail not found", { status: 404 }));
    }),
    Effect.catchAll(() => {
      return Effect.die(data("Internal server error", { status: 500 }));
    }),
    runtimeLive.runPromise
  );
};
