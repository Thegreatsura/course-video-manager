import { ThumbnailOperationsService } from "@/services/db-thumbnail-operations.server";
import { webFileStream } from "@/services/web-file-stream.server";
import { locateStoredVideoFile } from "@/services/video-files";
import { makeLoader } from "@/services/route-action.server";
import { Effect } from "effect";
import { data } from "react-router";

export const loader = makeLoader({
  effect: ({ params }) =>
    Effect.gen(function* () {
      const thumbnailOps = yield* ThumbnailOperationsService;
      const record = yield* thumbnailOps.getThumbnailById(params.thumbnailId!);

      if (!record.filePath) {
        return yield* Effect.die(
          data("Thumbnail has no rendered image", { status: 404 })
        );
      }

      // Root-relative: the first Storage Root that has it; legacy: as stored.
      const onDisk = locateStoredVideoFile(record.filePath);
      if (onDisk === null) {
        return yield* Effect.die(
          data("Thumbnail image not found on any Storage Root", {
            status: 404,
          })
        );
      }

      return new Response(webFileStream(onDisk), {
        headers: {
          "Content-Type": "image/png",
          "Cache-Control": "no-cache",
        },
      });
    }),
});
