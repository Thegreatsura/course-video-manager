import { Effect, Option } from "effect";
import { makeLoader } from "@/services/route-action.server";
import { findExportedVideo } from "@/services/finished-videos.server";
import { storageRootsConfig } from "@/services/storage-roots";

export const loader = makeLoader({
  effect: ({ params }) => {
    const videoId = params.videoId!;

    return Effect.gen(function* () {
      const storageRoots = yield* storageRootsConfig;
      const found = yield* findExportedVideo(storageRoots, `${videoId}.mp4`);
      return Response.json({ exists: Option.isSome(found) });
    }).pipe(
      Effect.catchAll(() => {
        return Effect.succeed(Response.json({ exists: false }));
      })
    );
  },
});
