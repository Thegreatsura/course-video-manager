import { Effect, Config } from "effect";
import { FileSystem } from "@effect/platform";
import { makeLoader } from "@/services/route-action.server";

export const loader = makeLoader({
  effect: ({ params }) => {
    const videoId = params.videoId!;

    return Effect.gen(function* () {
      const finishedDir = yield* Config.string("FINISHED_VIDEOS_DIRECTORY");
      const fs = yield* FileSystem.FileSystem;
      const exists = yield* fs.exists(`${finishedDir}/${videoId}.mp4`);
      return Response.json({ exists });
    }).pipe(
      Effect.catchAll(() => {
        return Effect.succeed(Response.json({ exists: false }));
      })
    );
  },
});
